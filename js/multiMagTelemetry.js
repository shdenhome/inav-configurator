import MSPCodes from './msp/MSPCodes.js';
export const MAG_FLAGS = {
    DETECTED: 1,
    READABLE: 2,
    FRESH: 4,
    CALIBRATED: 8,
    CALIBRATING: 16,
    CONTRIBUTOR: 32,
    FALLBACK: 64,
    POSITIVE_TRUST: 128,
    ORIENTATION_VALID: 256,
    CAL_FAILED: 512,
    READ_ERROR: 1024,
};
const names = {
    2: 'HMC5883',
    3: 'AK8975',
    4: 'MAG3110',
    5: 'AK8963',
    6: 'IST8310',
    7: 'QMC5883',
    8: 'QMC5883P',
    9: 'MPU9250',
    10: 'IST8308',
    11: 'LIS3MDL',
    12: 'MSP',
    13: 'RM3100',
    14: 'VCM5883',
    15: 'MLX90393',
    16: 'LIS2MDL',
    17: 'FAKE',
};
export function parseMultiMagPage(data, receivedAt = Date.now()) {
    if (!(data instanceof DataView) || data.byteLength < 24 || data.getUint8(0) !== 1) return null;
    let o = 0;
    const u8 = () => data.getUint8(o++),
        u16 = () => {
            const v = data.getUint16(o, true);
            o += 2;
            return v;
        },
        u32 = () => {
            const v = data.getUint32(o, true);
            o += 4;
            return v;
        },
        i16 = () => {
            const v = data.getInt16(o, true);
            o += 2;
            return v;
        },
        i32 = () => {
            const v = data.getInt32(o, true);
            o += 4;
            return v;
        };
    u8();
    const page = {
        flags: u8(),
        total: u8(),
        cursor: u8(),
        count: u8(),
        nextCursor: u8(),
        generation: u16(),
        captureUs: u32(),
        referenceUid: u32(),
        fallbackUid: u32(),
        calibrationRunId: u32(),
        receivedAt,
        sources: [],
    };
    if (
        page.total > 12 ||
        page.count > 4 ||
        page.cursor + page.count > page.total ||
        data.byteLength !== 24 + 48 * page.count
    )
        return null;
    if (page.nextCursor !== 255 && (page.nextCursor !== page.cursor + page.count || !page.count)) return null;
    for (let i = 0; i < page.count; i++) {
        const source = {
            uid: u32(),
            slot: u8(),
            hardware: u8(),
            bus: u8(),
            address: u8(),
            flags: u16(),
            confidence: u16(),
            ageUs: u32(),
            raw: [i16(), i16(), i16()],
            calibrated: [i32(), i32(), i32()],
            calStatus: u8(),
            orientationConfidence: u8(),
            angles: [i16(), i16(), i16()],
            sampleCount: u16(),
            failureCode: u8(),
            receivedAt,
        };
        o += 3;
        if (
            !source.uid ||
            !source.bus ||
            !source.address ||
            source.address > 127 ||
            source.slot >= 12 ||
            source.confidence > 1000 ||
            source.calStatus > 4 ||
            source.orientationConfidence > 100 ||
            page.sources.some((s) => s.uid === source.uid || s.slot === source.slot)
        )
            return null;
        page.sources.push(source);
    }
    return page;
}
function readPage(MSP, cursor, generation, timeoutMs) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (value) => {
            if (!done) {
                done = true;
                clearTimeout(timer);
                resolve(value);
            }
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        try {
            MSP.send_message(
                MSPCodes.MSP2_INAV_MULTI_MAG_STATE,
                [cursor, generation & 255, generation >> 8],
                false,
                (response) => finish(response ? parseMultiMagPage(response.data) : null)
            );
        } catch {
            finish(null);
        }
    });
}
export async function readMultiMagTelemetry(MSP, timeoutMs = 2000) {
    for (let attempt = 0; attempt < 2; attempt++) {
        let cursor = 0,
            first = null,
            sources = [],
            restart = false;
        for (let pages = 0; pages < 4; pages++) {
            const page = await readPage(MSP, cursor, first?.generation || 0, timeoutMs);
            if (!page) return null;
            if (
                first &&
                (page.generation !== first.generation ||
                    page.total !== first.total ||
                    page.calibrationRunId !== first.calibrationRunId)
            ) {
                restart = true;
                break;
            }
            if (page.cursor !== cursor) return null;
            first ||= page;
            for (const source of page.sources) {
                if (sources.some((s) => s.uid === source.uid || s.slot === source.slot)) return null;
                sources.push(source);
            }
            if (page.nextCursor === 255) {
                if (sources.length !== first.total) return null;
                return { ...first, sources, receivedAt: Date.now() };
            }
            cursor = page.nextCursor;
        }
        if (!restart) return null;
    }
    return null;
}
export function multiMagSeries(snapshot, now = Date.now()) {
    if (!snapshot) return [];
    const hostFresh = now >= snapshot.receivedAt && now - snapshot.receivedAt <= 1500;
    return snapshot.sources.map((s) => {
        const valid =
            hostFresh &&
            now >= (s.receivedAt ?? snapshot.receivedAt) &&
            now - (s.receivedAt ?? snapshot.receivedAt) <= 1500 &&
            Boolean(s.flags & MAG_FLAGS.READABLE) &&
            Boolean(s.flags & MAG_FLAGS.FRESH);
        return {
            ...s,
            key: 'mag-' + s.uid,
            name: names[s.hardware] || '#' + s.hardware,
            title: `MAG ${s.slot + 1} · ${names[s.hardware] || '#' + s.hardware} · I2C${s.bus}/0x${s.address.toString(16).toUpperCase().padStart(2, '0')}`,
            valid,
            values:
                valid && s.flags & MAG_FLAGS.CALIBRATED && s.flags & MAG_FLAGS.ORIENTATION_VALID
                    ? s.calibrated.map((v) => v / 1024)
                    : [NaN, NaN, NaN],
        };
    });
}
export function createMagCalibrationTracker(previousRunId, startedAt = Date.now()) {
    let observed = false;
    return (snapshot) => {
        if (!snapshot) return { done: false, error: Date.now() - startedAt > 180000 ? 'timeout' : null };
        if (snapshot.calibrationRunId !== previousRunId) observed = true;
        if (Date.now() - startedAt > 180000) return { done: false, error: 'timeout' };
        return {
            done: observed && !(snapshot.flags & 2) && snapshot.sources.every((s) => s.calStatus !== 1),
            error: null,
            observed,
            sources: snapshot.sources,
        };
    };
}

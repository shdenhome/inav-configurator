import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseMultiMagPage,
    readMultiMagTelemetry,
    multiMagSeries,
    createMagCalibrationTracker,
} from '../js/multiMagTelemetry.js';
function packet({
    cursor = 0,
    count = 1,
    total = count,
    next = 255,
    generation = 1,
    run = 1,
    flags = 5,
    uid = 100,
    slot = 0,
    sourceFlags = 431,
    confidence = 900,
    status = 2,
} = {}) {
    const d = new DataView(new ArrayBuffer(24 + 48 * count));
    let o = 0;
    const u8 = (v) => d.setUint8(o++, v),
        u16 = (v) => {
            d.setUint16(o, v, true);
            o += 2;
        },
        u32 = (v) => {
            d.setUint32(o, v, true);
            o += 4;
        },
        i16 = (v) => {
            d.setInt16(o, v, true);
            o += 2;
        },
        i32 = (v) => {
            d.setInt32(o, v, true);
            o += 4;
        };
    u8(1);
    u8(flags);
    u8(total);
    u8(cursor);
    u8(count);
    u8(next);
    u16(generation);
    u32(123000);
    u32(100);
    u32(0);
    u32(run);
    for (let i = 0; i < count; i++) {
        u32(uid + i);
        u8(slot + i);
        u8(11);
        u8(1);
        u8(30);
        u16(sourceFlags);
        u16(confidence);
        u32(10000);
        [-1, 2, -3].forEach(i16);
        [1024, -512, 256].forEach(i32);
        u8(status);
        u8(90);
        [0, 0, 900].forEach(i16);
        u16(60);
        u8(0);
        u8(0);
        u8(0);
        u8(0);
    }
    assert.equal(o, d.byteLength);
    return d;
}
test('MAG page roundtrips signed values, IDs, quality, per-source calibration and orientation', () => {
    const p = parseMultiMagPage(packet());
    assert.equal(p.sources[0].uid, 100);
    assert.deepEqual(p.sources[0].raw, [-1, 2, -3]);
    assert.deepEqual(p.sources[0].calibrated, [1024, -512, 256]);
    assert.deepEqual(p.sources[0].angles, [0, 0, 900]);
    assert.equal(p.sources[0].sampleCount, 60);
});
test('truncated/version/oversized/invalid pages are rejected', () => {
    for (const size of [0, 23, 71]) assert.equal(parseMultiMagPage(new DataView(new ArrayBuffer(size))), null);
    const d = packet();
    d.setUint8(0, 2);
    assert.equal(parseMultiMagPage(d), null);
    const invalid = packet();
    invalid.setUint16(34, 1001, true);
    assert.equal(parseMultiMagPage(invalid), null);
    const duplicate = packet({ count: 2 });
    duplicate.setUint32(72, 100, true);
    assert.equal(parseMultiMagPage(duplicate), null);
});
test('all pages merge by stable UID rather than shifting slots', async () => {
    const payloads = [];
    const MSP = {
        send_message(code, payload, unused, callback) {
            payloads.push(payload);
            callback({
                data:
                    payload[0] === 0
                        ? packet({ count: 4, total: 5, next: 4 })
                        : packet({ cursor: 4, count: 1, total: 5, uid: 300, slot: 8 }),
            });
        },
    };
    const s = await readMultiMagTelemetry(MSP);
    assert.equal(s.sources.length, 5);
    assert.equal(s.sources[4].slot, 8);
    assert.deepEqual(payloads, [
        [0, 0, 0],
        [4, 1, 0],
    ]);
});
test('generation changes restart the pass and never expose a mixed inventory', async () => {
    let n = 0;
    const MSP = {
        send_message(c, p, u, cb) {
            n++;
            cb({
                data:
                    n === 1
                        ? packet({ count: 1, total: 2, next: 1 })
                        : n === 2
                          ? packet({ cursor: 1, total: 2, generation: 2, uid: 200, slot: 1 })
                          : packet({ generation: 2, uid: 300 }),
            });
        },
    };
    const s = await readMultiMagTelemetry(MSP);
    assert.equal(n, 3);
    assert.equal(s.sources.length, 1);
    assert.equal(s.sources[0].uid, 300);
});
test('a failed page returns no partial snapshot and unsupported/timeout settles', async () => {
    const MSP = {
        send_message(c, p, u, cb) {
            cb(p[0] === 0 ? { data: packet({ count: 1, total: 2, next: 1 }) } : false);
        },
    };
    assert.equal(await readMultiMagTelemetry(MSP), null);
    assert.equal(await readMultiMagTelemetry({ send_message() {} }, 1), null);
});
test('zero trust fallback still graphs fresh calibrated samples, stale samples become gaps', () => {
    const p = parseMultiMagPage(packet({ sourceFlags: 367, confidence: 0 }), 1000);
    const s = multiMagSeries(p, 1000)[0];
    assert.equal(s.confidence, 0);
    assert.ok(s.flags & 64);
    assert.deepEqual(s.values, [1, -0.5, 0.25]);
    assert.ok(multiMagSeries(p, 3000)[0].values.every(Number.isNaN));
});
test('uncalibrated source exposes raw values but not a false normalized trace', () => {
    const p = parseMultiMagPage(packet({ sourceFlags: 7, status: 0 }), 1000);
    const s = multiMagSeries(p, 1000)[0];
    assert.deepEqual(s.raw, [-1, 2, -3]);
    assert.ok(s.values.every(Number.isNaN));
});
test('calibration cannot complete until new run is observed; all per-source outcomes matter', () => {
    const track = createMagCalibrationTracker(10);
    assert.equal(track({ calibrationRunId: 10, flags: 0, sources: [] }).done, false);
    assert.equal(track({ calibrationRunId: 11, flags: 2, sources: [{ calStatus: 1 }] }).done, false);
    assert.equal(track({ calibrationRunId: 11, flags: 0, sources: [{ calStatus: 1 }, { calStatus: 3 }] }).done, false);
    assert.equal(
        track({ calibrationRunId: 11, flags: 0, sources: [{ calStatus: 2 }, { calStatus: 3 }, { calStatus: 4 }] }).done,
        true
    );
});
test('empty inventories and run counter wrap terminate only a newly observed calibration', () => {
    const track = createMagCalibrationTracker(0xffffffff);
    assert.equal(track({ calibrationRunId: 0, flags: 0, sources: [] }).done, true);
    const expired = createMagCalibrationTracker(1, Date.now() - 180001);
    assert.equal(expired(null).error, 'timeout');
});

test('actual firmware C serializer pages match the JS protocol and assemble all twelve sources', async () => {
    const pages = JSON.parse(readFileSync(new URL('./fixtures/multi-mag-c-pages.json', import.meta.url), 'utf8'));
    const parsed = pages.map((hex) => {
        const b = Buffer.from(hex, 'hex');
        assert.equal(b.length, 216);
        return parseMultiMagPage(new DataView(b.buffer, b.byteOffset, b.byteLength));
    });
    assert.deepEqual(
        parsed.map((p) => [p.cursor, p.count, p.nextCursor]),
        [
            [0, 4, 4],
            [4, 4, 8],
            [8, 4, 255],
        ]
    );
    assert.equal(parsed[0].generation, 44519);
    assert.equal(parsed[0].sources[0].uid, 68619);
    assert.deepEqual(parsed[0].sources[0].raw, [1024, 10, 10]);
    assert.equal(parsed[1].sources[0].confidence, 1000);
    assert.deepEqual(parsed[1].sources[0].calibrated, [1024, 10, 10]);
    let index = 0;
    const requests = [];
    const MSP = {
        send_message(code, payload, unused, callback) {
            requests.push(payload);
            const b = Buffer.from(pages[index++], 'hex');
            callback({ data: new DataView(b.buffer, b.byteOffset, b.byteLength) });
        },
    };
    const snapshot = await readMultiMagTelemetry(MSP);
    assert.equal(snapshot.sources.length, 12);
    assert.equal(new Set(snapshot.sources.map((s) => s.uid)).size, 12);
    assert.deepEqual(
        snapshot.sources.map((s) => s.slot),
        Array.from({ length: 12 }, (_, i) => i)
    );
    assert.deepEqual(requests, [
        [0, 0, 0],
        [4, 231, 173],
        [8, 231, 173],
    ]);
});

test('maximum 120-second calibration retains finalization and transport slack before timeout', () => {
    const tracker = createMagCalibrationTracker(10, Date.now() - 125000);
    const progress = tracker({ calibrationRunId: 11, flags: 2, sources: [{ calStatus: 1 }] });
    assert.equal(progress.done, false);
    assert.equal(progress.error, null);
    assert.equal(tracker({ calibrationRunId: 11, flags: 0, sources: [{ calStatus: 2 }] }).done, true);
    assert.equal(createMagCalibrationTracker(10, Date.now() - 180001)(null).error, 'timeout');
});

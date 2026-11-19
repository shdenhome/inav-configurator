import MSPCodes from './msp/MSPCodes.js';

export const MULTI_IMU = { PRESENT: 1, GYRO_VALID: 2, ACC_VALID: 4, CALIBRATED: 8, RAW_ACC_VALID: 16, GYRO_CONTRIBUTOR: 32, ACC_CONTRIBUTOR: 64 };
export const MULTI_BARO = { PRESENT: 1, VALID: 2, ALTITUDE_VALID: 4, CONTRIBUTOR: 8 };
const STATE_BYTES = 211;

export function sensorTypeName(type, barometer = false) {
    const names = barometer ? { 3: 'MS5611', 7: 'SPL06' } : { 2: 'MPU6000', 3: 'MPU6500', 8: 'ICM42605' };
    return names[type] || `#${type}`;
}

export function parseMultiSensorTelemetry(data, receivedAt = Date.now()) {
    if (!(data instanceof DataView) || data.byteLength < STATE_BYTES || data.getUint8(0) !== 1 || data.getUint8(2) !== 3 || data.getUint8(3) !== 2) return null;
    let offset = 4;
    const u8 = () => data.getUint8(offset++);
    const u16 = () => { const value = data.getUint16(offset, true); offset += 2; return value; };
    const u32 = () => { const value = data.getUint32(offset, true); offset += 4; return value; };
    const i32 = () => { const value = data.getInt32(offset, true); offset += 4; return value; };
    const vector = () => [i32() / 1000, i32() / 1000, i32() / 1000];
    const snapshot = { flags: data.getUint8(1), timestampUs: u32(), receivedAt, imus: [], barometers: [] };
    for (let i = 0; i < 3; i++) {
        const imu = { tag: u8(), type: u8(), flags: u8(), gyroTrust: u16(), accTrust: u16(), gyroAgeUs: u32(), accAgeUs: u32(), gyro: vector(), acc: vector(), rawAcc: vector() };
        if (imu.tag >= 3 || snapshot.imus[imu.tag] || imu.gyroTrust > 1000 || imu.accTrust > 1000) return null;
        snapshot.imus[imu.tag] = imu;
    }
    for (let i = 0; i < 2; i++) {
        const baro = { slot: u8(), type: u8(), flags: u8(), trust: u16(), ageUs: u32(), pressurePa: i32(), alignedPressurePa: i32(), temperatureC: i32() / 100, altitudeM: i32() / 100 };
        if (baro.slot >= 2 || snapshot.barometers[baro.slot] || baro.trust > 1000) return null;
        snapshot.barometers[baro.slot] = baro;
    }
    return snapshot;
}

// Resolve every request, including queue rejection, unsupported firmware and timeout.
export function readMultiSensorTelemetry(MSP, timeoutMs = 2000) {
    return new Promise(resolve => {
        let done = false;
        const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
        const timer = setTimeout(() => finish(null), timeoutMs);
        try {
            MSP.send_message(MSPCodes.MSP2_INAV_MULTI_SENSOR_STATE, false, false, response => finish(response ? parseMultiSensorTelemetry(response.data) : null));
        } catch {
            finish(null);
        }
    });
}

export function multiSensorGraphSeries(snapshot, kind, now = Date.now()) {
    if (!snapshot) return [];
    const fresh = now >= snapshot.receivedAt && now - snapshot.receivedAt <= 1000;
    if (kind === 'baro') return snapshot.barometers.filter(source => source.flags & MULTI_BARO.PRESENT).map(source => ({
        key: `baro-${source.slot}`, index: source.slot, name: sensorTypeName(source.type, true), trust: source.trust,
        values: [fresh && (source.flags & MULTI_BARO.ALTITUDE_VALID) ? source.altitudeM : NaN],
        pressurePa: fresh && (source.flags & MULTI_BARO.VALID) ? source.pressurePa : NaN,
        valid: fresh && Boolean(source.flags & MULTI_BARO.VALID), calibrated: Boolean(source.flags & MULTI_BARO.ALTITUDE_VALID),
    }));
    return snapshot.imus.filter(source => source.flags & MULTI_IMU.PRESENT).map(source => {
        const calibrated = Boolean(source.flags & MULTI_IMU.CALIBRATED);
        const valid = fresh && Boolean(source.flags & (kind === 'gyro' ? MULTI_IMU.GYRO_VALID : calibrated ? MULTI_IMU.ACC_VALID : MULTI_IMU.RAW_ACC_VALID));
        return {
            key: `${kind}-${source.tag}`, index: source.tag, name: sensorTypeName(source.type),
            trust: kind === 'gyro' ? source.gyroTrust : source.accTrust, valid, calibrated: kind === 'gyro' || calibrated,
            values: valid ? (kind === 'gyro' ? source.gyro : calibrated ? source.acc : source.rawAcc) : [NaN, NaN, NaN],
        };
    });
}

export function createMultiSensorCsvSchema({ imu, baro }) {
    const columns = [];
    const add = (name, read) => columns.push({ name, read });
    if (imu || baro) add('multi_sensor_time_us', snapshot => snapshot?.timestampUs ?? '');
    if (imu) for (let tag = 0; tag < 3; tag++) {
        const prefix = `imu${tag + 1}_`;
        const source = snapshot => snapshot?.imus[tag];
        const value = (snapshot, field, required = MULTI_IMU.PRESENT) => { const s = source(snapshot); return s && (s.flags & required) ? s[field] : ''; };
        add(prefix + 'type', snapshot => { const s = source(snapshot); return s && (s.flags & MULTI_IMU.PRESENT) ? sensorTypeName(s.type) : ''; });
        for (const [name, bit] of [['present',1],['gyro_valid',2],['acc_valid',4],['acc_calibrated',8],['raw_acc_valid',16],['gyro_contributing',32],['acc_contributing',64]]) {
            add(prefix + name, snapshot => source(snapshot) ? Number(Boolean(source(snapshot).flags & bit)) : '');
        }
        add(prefix + 'gyro_confidence', snapshot => value(snapshot, 'gyroTrust'));
        add(prefix + 'acc_confidence', snapshot => value(snapshot, 'accTrust'));
        add(prefix + 'gyro_age_us', snapshot => value(snapshot, 'gyroAgeUs'));
        add(prefix + 'acc_age_us', snapshot => value(snapshot, 'accAgeUs'));
        for (const [field, suffix, validBit] of [['gyro','dps',MULTI_IMU.GYRO_VALID],['acc','g',MULTI_IMU.ACC_VALID],['rawAcc','g',MULTI_IMU.RAW_ACC_VALID]]) {
            for (let axis = 0; axis < 3; axis++) add(prefix + `${field}_${'xyz'[axis]}_${suffix}`, snapshot => { const s = source(snapshot); return s && (s.flags & validBit) ? s[field][axis] : ''; });
        }
    }
    if (baro) for (let slot = 0; slot < 2; slot++) {
        const prefix = `baro${slot + 1}_`;
        const source = snapshot => snapshot?.barometers[slot];
        add(prefix + 'type', snapshot => { const s = source(snapshot); return s && (s.flags & MULTI_BARO.PRESENT) ? sensorTypeName(s.type, true) : ''; });
        for (const [name, bit] of [['present',1],['valid',2],['altitude_valid',4],['contributing',8]]) {
            add(prefix + name, snapshot => source(snapshot) ? Number(Boolean(source(snapshot).flags & bit)) : '');
        }
        for (const [name, field, bit] of [['confidence','trust',1],['age_us','ageUs',1],['pressure_pa','pressurePa',2],['aligned_pressure_pa','alignedPressurePa',2],['temperature_c','temperatureC',2],['altitude_m','altitudeM',4]]) {
            add(prefix + name, snapshot => { const s = source(snapshot); return s && (s.flags & bit) ? s[field] : ''; });
        }
    }
    return { headers: columns.map(column => column.name), values: snapshot => columns.map(column => column.read(snapshot)) };
}

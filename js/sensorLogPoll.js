import MSPCodes from './msp/MSPCodes.js';
import { parseMultiSensorTelemetry } from './multiSensorTelemetry.js';

export function readLogResponse(MSP, code, timeoutMs = 2000) {
    return new Promise(resolve => {
        let settled = false;
        const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
        const timer = setTimeout(() => finish(null), timeoutMs);
        try { MSP.send_message(code, false, false, response => finish(response || null)); }
        catch { finish(null); }
    });
}

export function createSensorLogPoll(MSP, codes, includeMulti, onSample, timeoutMs = 2000) {
    let active = true;
    let busy = false;
    return {
        cancel() { active = false; },
        async poll() {
            if (!active || busy) return false;
            busy = true;
            try {
                const requested = [...new Set(codes)];
                if (includeMulti && !requested.includes(MSPCodes.MSP2_INAV_MULTI_SENSOR_STATE)) requested.push(MSPCodes.MSP2_INAV_MULTI_SENSOR_STATE);
                const responses = await Promise.all(requested.map(code => readLogResponse(MSP, code, timeoutMs)));
                if (!active) return false;
                const successful = new Set();
                let snapshot = null;
                requested.forEach((code, index) => {
                    const response = responses[index];
                    if (response?.length && !MSP.parseFailures?.has(code)) successful.add(code);
                    if (code === MSPCodes.MSP2_INAV_MULTI_SENSOR_STATE && response) snapshot = parseMultiSensorTelemetry(response.data);
                });
                onSample(snapshot, successful);
                return true;
            } finally { busy = false; }
        },
    };
}

// Serialize appends so the final partial buffer cannot overtake an earlier batch.
export function createSensorLogWriter(append, onWritten = () => {}, onError = () => {}) {
    let tail = Promise.resolve();
    return {
        append(rows) {
            if (!rows.length) return tail;
            const text = rows.join('\n') + '\n';
            tail = tail.then(() => append(text)).then(() => onWritten(rows.length));
            tail.catch(onError);
            return tail;
        },
        finished() { return tail; },
    };
}

export function createLegacyLogSchema(properties, FC) {
    const channels = FC.RC.active_channels;
    const motors = FC.MOTOR_DATA.length;
    const debug = FC.SENSOR_DATA.debug.length;
    const groups = {
        MSP_RAW_IMU: { headers: ['gyroscopeX','gyroscopeY','gyroscopeZ','accelerometerX','accelerometerY','accelerometerZ','magnetometerX','magnetometerY','magnetometerZ'], read: () => [...FC.SENSOR_DATA.gyroscope.slice(0,3),...FC.SENSOR_DATA.accelerometer.slice(0,3),...FC.SENSOR_DATA.magnetometer.slice(0,3)] },
        MSP_ATTITUDE: { headers: ['kinematicsX','kinematicsY','kinematicsZ'], read: () => FC.SENSOR_DATA.kinematics.slice(0,3) },
        MSP_ALTITUDE: { headers: ['altitude'], read: () => [FC.SENSOR_DATA.altitude] },
        MSP_RAW_GPS: { headers: ['gpsFix','gpsNumSat','gpsLat','gpsLon','gpsAlt','gpsSpeed','gpsGroundCourse'], read: () => [FC.GPS_DATA.fix,FC.GPS_DATA.numSat,FC.GPS_DATA.lat/10000000,FC.GPS_DATA.lon/10000000,FC.GPS_DATA.alt,FC.GPS_DATA.speed,FC.GPS_DATA.ground_course] },
        MSP_ANALOG: { headers: ['voltage','amperage','mAhdrawn','rssi'], read: () => [FC.ANALOG.voltage,FC.ANALOG.amperage,FC.ANALOG.mAhdrawn,FC.ANALOG.rssi] },
        MSP_RC: { headers: Array.from({length:channels},(_,i)=>'RC'+i), read: () => FC.RC.channels },
        MSP_MOTOR: { headers: Array.from({length:motors},(_,i)=>'Motor'+i), read: () => FC.MOTOR_DATA },
        MSP_DEBUG: { headers: Array.from({length:debug},(_,i)=>'Debug'+i), read: () => FC.SENSOR_DATA.debug },
    };
    const selected = properties.filter(name => groups[name]).map(name => ({code:MSPCodes[name],...groups[name]}));
    return {
        headers: selected.flatMap(group=>group.headers),
        values(successful) {
            return selected.flatMap(group => {
                const values = successful.has(group.code) ? group.read() : [];
                return group.headers.map((_,i)=>Number.isFinite(values[i])?values[i]:'');
            });
        },
    };
}

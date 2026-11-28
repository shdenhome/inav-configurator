// Protocol numbers match motorPwmProtocolTypes_e; DEFAULT is not a waveform.
export const TIMER_PROTOCOL_DEFAULT = 255;
export const TIMER_PROTOCOL_NAMES = {0: 'STANDARD', 1: 'ONESHOT125', 2: 'MULTISHOT', 3: 'BRUSHED', 4: 'DSHOT150', 5: 'DSHOT300', 6: 'DSHOT600', 7: 'SRXL2'};

export function parseTimerProtocols(data, capabilities = false) {
    if (!data || data.byteLength < 2 || data.getUint8(0) !== 1) return null;
    const count = data.getUint8(1);
    if (data.byteLength !== 2 + count * 3) return null;
    const records = [];
    const seen = new Set();
    for (let i = 0; i < count; i++) {
        const offset = 2 + i * 3, timer = data.getUint8(offset);
        if (timer >= count || seen.has(timer)) return null;
        seen.add(timer);
        if (capabilities) records.push({timer, mask: data.getUint16(offset + 1, true)});
        else {
            const configured = data.getUint8(offset + 1), effective = data.getUint8(offset + 2);
            if (![0, 4, 5, 6, 255].includes(configured) || !Object.hasOwn(TIMER_PROTOCOL_NAMES, effective)) return null;
            records.push({timer, configured, effective});
        }
    }
    return records;
}

export function encodeTimerProtocols(records) {
    if (!Array.isArray(records) || records.length > 255) throw new Error('Invalid timer protocol configuration');
    const timers = new Set();
    const bytes = [1, records.length];
    for (const {timer, configured} of records) {
        if (!Number.isInteger(timer) || timer < 0 || timer > 254 || timers.has(timer)
            || ![0, 4, 5, 6, 255].includes(configured)) throw new Error('Invalid timer protocol configuration');
        timers.add(timer);
        bytes.push(timer, configured);
    }
    return bytes;
}

export function effectiveTimerProtocol(record, globalProtocol) {
    return record?.configured !== undefined && record.configured !== 255 ? record.configured : Number(globalProtocol);
}

// Only groups actually carrying motors participate. Stored overrides on servo/LED
// groups are retained without mislabelling the motor configuration as MIXED.
export function summarizeTimerProtocols(records, globalProtocol, motorTimers) {
    const protocols = [...new Set([...motorTimers].map(timer => effectiveTimerProtocol(records.find(r => r.timer === Number(timer)), globalProtocol)))];
    return {mixed: protocols.length > 1, protocols};
}

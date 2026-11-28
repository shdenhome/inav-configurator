// Calibration changes one confirmed RAM setting; EEPROM remains the Save action.
export const BATTERY_CALIBRATIONS = {
    voltage1: { battery: 1, measurement: 'voltage', setting: 'vbat_scale', min: 1, max: 65535 },
    current1: { battery: 1, measurement: 'current', setting: 'current_meter_scale', min: -10000, max: 10000 },
    voltage2: { battery: 2, measurement: 'voltage', setting: 'battery2_voltage_scale', min: 1, max: 65535 },
    current2: { battery: 2, measurement: 'current', setting: 'battery2_current_scale', min: 1, max: 65535 },
};
export function calibrationError(code) {
    return Object.assign(new Error(code), { code: 'batteryCalibration' + code });
}
export function parseCalibrationReference(input) {
    const text = String(input).trim();
    if (!/^\+?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(text))
        throw calibrationError('InvalidInput');
    const value = Number(text.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) throw calibrationError('InvalidInput');
    return value;
}
export function calculateBatteryScale(key, sample, reference) {
    const spec = BATTERY_CALIBRATIONS[key];
    if (!spec) throw calibrationError('Unsupported');
    const actual = parseCalibrationReference(reference);
    const { scale, value, offset = 0 } = sample;
    if (!Number.isFinite(value) || value <= 0 || (spec.measurement === 'voltage' && value < 0))
        throw calibrationError('NoSample');
    if (!Number.isInteger(scale) || scale === 0 || !Number.isFinite(offset)) throw calibrationError('Range');
    const effectiveOffset = spec.battery === 2 && spec.measurement === 'voltage' ? offset : 0;
    const denominator = spec.measurement === 'current' ? actual : value - effectiveOffset;
    if (denominator <= 0) throw calibrationError('NoSample');
    const result = spec.measurement === 'current'
        ? scale * value / actual
        : scale * (actual - effectiveOffset) / denominator;
    const rounded = Math.round(result);
    const min = Math.max(spec.min, Number.isFinite(sample.min) ? sample.min : spec.min);
    const max = Math.min(spec.max, Number.isFinite(sample.max) ? sample.max : spec.max);
    if (!Number.isFinite(result) || result < min || result > max || rounded < min || rounded > max || rounded === 0)
        throw calibrationError('Range');
    return rounded;
}
export function createBatteryCalibrationController(io) {
    let busy = false;
    const uncertain = new Map();
    const active = () => !io.isActive || io.isActive();
    function validate(key, sample) {
        const spec = BATTERY_CALIBRATIONS[key];
        if (!spec || !sample || !sample.enabled ||
            !(spec.battery === 1 ? sample.sensor === 'ADC' : ['ADC', 'I2C'].includes(sample.sensor)) ||
            (key === 'voltage1' && !sample.raw)) throw calibrationError('Unsupported');
        if (!Number.isFinite(sample.value) || sample.value <= 0 ||
            (spec.measurement === 'voltage' && sample.value < 0)) throw calibrationError('NoSample');
        if (!Number.isInteger(sample.scale) || sample.scale === 0) throw calibrationError('Range');
        const ui = io.getUi(key);
        if (['scale', 'offset', 'sensor', 'enabled', 'raw'].some(field => ui[field] !== sample[field]))
            throw calibrationError('Unsaved');
        return sample;
    }
    async function snapshot(key) {
        if (!active()) throw calibrationError('Communication');
        const sample = await io.readSnapshot(key);
        if (!active()) throw calibrationError('Communication');
        const old = uncertain.get(key);
        if (old && io.getUi(key).scale === old.scale) {
            io.setScale(key, sample.scale);
            uncertain.delete(key);
        }
        return validate(key, sample);
    }
    return {
        get busy() { return busy || Boolean(io.isWritePending?.()); },
        read: snapshot,
        async apply(key, reference, stillOpen = active) {
            const actual = parseCalibrationReference(reference);
            if (io.isWritePending?.()) throw calibrationError('Unconfirmed');
            if (busy) throw calibrationError('Settling');
            busy = true;
            try {
                const before = await snapshot(key);
                const scale = calculateBatteryScale(key, before, actual);
                if (!active() || !stillOpen()) throw calibrationError('Communication');
                if (scale === before.scale) return { ...before, unchanged: true };
                // A missing ACK is ambiguous; read back the one setting before claiming success.
                uncertain.set(key, before);
                try { await io.writeScale(key, scale, stillOpen); } catch { /* readback resolves the actual state */ }
                if (!active()) return { scale, value: null, pending: true };
                let confirmed;
                try { confirmed = await io.readScale(key); }
                catch {
                    if (!active()) return { scale, value: null, pending: true };
                    io.markUnconfirmed?.();
                    throw calibrationError('Unconfirmed');
                }
                if (!active()) return { scale, value: null, pending: true };
                if (io.isWritePending?.()) throw calibrationError('Unconfirmed');
                if (confirmed !== scale) {
                    if (confirmed === before.scale) uncertain.delete(key);
                    if (confirmed !== before.scale) io.markUnconfirmed?.();
                    throw calibrationError(confirmed === before.scale ? 'Communication' : 'Unconfirmed');
                }
                uncertain.delete(key);
                if (active()) io.setScale(key, scale);
                // Existing 1 Hz battery filters must settle before the next calibration.
                await io.sleep(2000);
                if (!active()) return { scale, value: null, pending: true };
                try {
                    const after = await snapshot(key);
                    if (after.scale !== scale) throw calibrationError('Communication');
                    return after;
                } catch { return { scale, value: null, pending: true }; }
            } finally { busy = false; }
        },
    };
}

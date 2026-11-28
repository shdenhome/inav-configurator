import { BATTERY_CALIBRATIONS, calibrationError, createBatteryCalibrationController } from './batteryCalibration.js';
const sessions = new WeakMap();
const fields = {
    voltage1: { scale: '#voltagescale', sensor: '#vbat_meter_type', bit: 1 },
    current1: { scale: '#currentscale', sensor: '#current_meter_type', offset: '#currentoffset', bit: 11 },
    voltage2: { scale: '#battery2-voltage-scale', sensor: '#battery2-voltage-sensor', offset: '#battery2-voltage-offset', enabled: '#battery2-voltage-enabled' },
    current2: { scale: '#battery2-current-scale', sensor: '#battery2-current-sensor', offset: '#battery2-current-offset', enabled: '#battery2-current-enabled' },
};
export function installBatteryCalibration({ $, MSP, codes, helper, FC, i18n, openDialog, isActive: tabActive, sessionToken = () => MSP }) {
    const installedToken = sessionToken();
    const isActive = () => tabActive() && sessionToken() === installedToken;
    function session() {
        const token = sessionToken();
        let state = sessions.get(MSP);
        if (!state || state.token !== token) {
            state = { token, pending: false, uncertain: false };
            sessions.set(MSP, state);
        }
        return state;
    }
    const capabilities = new Map();
    let dialog = null;
    const number = selector => {
        const text = String($(selector).val() ?? '').trim();
        return text === '' ? NaN : Number(text);
    };
    function ui(key) {
        const f = fields[key], spec = BATTERY_CALIBRATIONS[key];
        const sensor = spec.battery === 1
            ? $(f.sensor).data('setting-info')?.table?.values?.[number(f.sensor)]
            : ['I2C', 'CAN', 'ADC'][number(f.sensor)];
        return { scale: number(f.scale), offset: f.offset ? number(f.offset) : 0, sensor,
            enabled: f.enabled ? $(f.enabled).prop('checked') : $(`.tab-configuration .feature[data-bit="${f.bit}"]`).prop('checked'),
            raw: key !== 'voltage1' || number('#voltagesource') === 0 };
    }
    async function timed(promise, duration = 4000) {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(calibrationError('Communication')), duration);
        })]); } finally { clearTimeout(timer); }
    }
    async function request(code) {
        if (!isActive()) throw calibrationError('Communication');
        const response = await timed(MSP.promise(code, false));
        if (!isActive() || !response || response.unsupported || !(response.data instanceof DataView)) throw calibrationError('Communication');
        return response.data;
    }
    async function setting(name) {
        if (!isActive()) throw calibrationError('Communication');
        const result = await timed(helper.getSetting(name));
        if (!isActive() || !result || !Number.isFinite(result.value)) throw calibrationError('Unsupported');
        return result;
    }
    async function readSnapshot(key) {
        const spec = BATTERY_CALIBRATIONS[key];
        if (!spec) throw calibrationError('Unsupported');
        const scale = await setting(spec.setting);
        let sensor, offset = 0, enabled, raw = true, value;
        if (spec.battery === 1) {
            const type = await setting(key === 'voltage1' ? 'vbat_meter_type' : 'current_meter_type');
            sensor = type.setting.table?.values?.[type.value];
            if (key === 'voltage1') raw = (await setting('bat_voltage_src')).value === 0;
            else offset = (await setting('current_meter_offset')).value / 10;
            const features = await request(codes.MSP_FEATURE);
            if (features.byteLength !== 4) throw calibrationError('Communication');
            const mask = features.getUint32(0, true);
            enabled = Boolean(mask & (1 << fields[key].bit));
            const data = await request(codes.MSPV2_INAV_ANALOG);
            if (data.byteLength !== 24) throw calibrationError('NoSample');
            if (((data.getUint8(0) >> 2) & 3) === 3 && (key === 'voltage1' || (mask & (1 << 1)))) throw calibrationError('NoSample');
            if ((key === 'voltage1' ? data.getUint16(1, true) === 65535 : data.getInt16(3, true) === 32767)) throw calibrationError('NoSample');
            value = key === 'voltage1' ? data.getUint16(1, true) / 100 : data.getInt16(3, true) / 100;
        } else {
            const config = await request(codes.MSPV2_INAV_BATTERY2_CONFIG);
            if (![20, 21].includes(config.byteLength)) throw calibrationError('Unsupported');
            const voltage = key === 'voltage2';
            enabled = config.getUint8(voltage ? 15 : 17) === 1;
            sensor = ['I2C', 'CAN', 'ADC'][config.getUint8(voltage ? 16 : 18)];
            offset = config.getInt16(voltage ? 2 : 6, true) / (voltage ? 100 : 1);
            if (scale.value !== config.getUint16(voltage ? 0 : 4, true)) throw calibrationError('Communication');
            const data = await request(codes.MSPV2_INAV_BATTERY2_STATE);
            if (data.byteLength !== 11 || data.getUint8(0) !== 1 || data.getUint8(1) > 2) throw calibrationError('NoSample');
            if (voltage ? data.getUint16(3, true) === 65535 : data.getInt16(5, true) === 32767) throw calibrationError('NoSample');
            value = voltage ? data.getUint16(3, true) / 100 : data.getInt16(5, true) / 100;
        }
        return { value, scale: scale.value, min: scale.setting.min, max: scale.setting.max, sensor, offset, enabled, raw };
    }
    const controller = createBatteryCalibrationController({ readSnapshot, getUi: ui, isActive,
        readScale: async key => (await setting(BATTERY_CALIBRATIONS[key].setting)).value,
        isWritePending: () => session().pending || session().uncertain,
        markUnconfirmed: () => { if (isActive()) session().uncertain = true; },
        writeScale: async (key, scale, stillOpen) => {
            const data = await timed(helper.encodeSetting(BATTERY_CALIBRATIONS[key].setting, scale));
            if (!isActive() || !stillOpen()) throw calibrationError('Communication');
            const state = session();
            if (state.pending || state.uncertain) throw calibrationError('Unconfirmed');
            state.pending = true;
            const response = Promise.resolve().then(() => MSP.promise(codes.MSPV2_SET_SETTING, data));
            response.then(() => { state.pending = false; }, () => { state.pending = false; });
            let ack;
            try { ack = await timed(response, 15000); }
            catch (error) {
                // A timed-out command can still be retried by the shared MSP queue.
                // Require a new connection before allowing another write/Save.
                if (state.pending) state.uncertain = true;
                throw error;
            }
            if (!ack || ack.unsupported) throw calibrationError('Communication');
        },
        setScale(key, scale) {
            $(fields[key].scale).val(scale);
            if (key === 'voltage1') FC.MISC.vbatscale = scale;
            else if (key === 'current1') FC.CURRENT_METER_CONFIG.scale = scale;
            else FC.BATTERY2.config[key === 'voltage2' ? 'voltage_scale' : 'current_scale'] = scale;
        },
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    });
    function update() {
        if (!isActive()) return;
        for (const [key, spec] of Object.entries(BATTERY_CALIBRATIONS)) {
            const current = ui(key);
            const supported = capabilities.get(key) && current.enabled && current.raw &&
                (spec.battery === 1 ? current.sensor === 'ADC' : ['I2C', 'ADC'].includes(current.sensor));
            $(`[data-battery-calibration="${key}"]`).prop('disabled', !supported || controller.busy)
                .attr('aria-label', i18n.getMessage(spec.measurement === 'voltage' ? 'batteryCalibrationTitleVoltage' : 'batteryCalibrationTitleCurrent', [spec.battery]))
                .attr('title', i18n.getMessage(spec.measurement === 'voltage' ? 'batteryCalibrationTitleVoltage' : 'batteryCalibrationTitleCurrent', [spec.battery]));
        }
    }
    $('.tab-configuration').on('change.batteryCalibration', 'input, select', update);
    $('[data-battery-calibration]').on('click.batteryCalibration', function () {
        if ($(this).prop('disabled') || !isActive()) return;
        if (controller.busy) return;
        const key = $(this).attr('data-battery-calibration'), spec = BATTERY_CALIBRATIONS[key];
        if (!spec) return;
        dialog?.close();
        let open = true;
        dialog = openDialog({
            title: i18n.getMessage(spec.measurement === 'voltage' ? 'batteryCalibrationTitleVoltage' : 'batteryCalibrationTitleCurrent', [spec.battery]),
            unit: spec.measurement === 'voltage' ? 'V' : 'A', isActive,
            read: () => controller.read(key),
            apply: async reference => {
                try { return await controller.apply(key, reference, () => open && isActive()); }
                finally { update(); }
            },
            onClose: () => { open = false; },
        });
    });
    update();
    const ready = (async () => {
        for (const [key, spec] of Object.entries(BATTERY_CALIBRATIONS)) {
            try { const s = await setting(spec.setting); capabilities.set(key, Boolean(s.setting)); }
            catch { capabilities.set(key, false); }
            update();
        }
    })();
    return { ready, update, busy: () => controller.busy, requiresReconnect: () => session().uncertain,
        destroy() { dialog?.close(); dialog = null; $('.tab-configuration').off('.batteryCalibration'); $('[data-battery-calibration]').off('.batteryCalibration'); },
    };
}

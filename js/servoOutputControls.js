// INAV 10: flight/servos.h SERVO_OUTPUT_MIN/MAX; CLI servo validates these bounds.
export const SERVO_PULSE_LIMITS = Object.freeze({ min: 500, max: 2500 });
const pulseFields = ['min', 'middle', 'max'];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function pulse(value, fallback) {
    const number = value === '' || value == null ? NaN : Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
}

export function normalizeServoRange(range, editedField, previous = { min: 1000, middle: 1500, max: 2000 }, limits = SERVO_PULSE_LIMITS) {
    let min = clamp(pulse(range.min, previous.min), limits.min, limits.max);
    let max = clamp(pulse(range.max, previous.max), limits.min, limits.max);
    let middle = clamp(pulse(range.middle, previous.middle), limits.min, limits.max);
    if (editedField === 'min' || editedField === 'max') {
        min = Math.min(min, middle);
        max = Math.max(max, middle);
    } else {
        max = Math.max(min, max);
        middle = clamp(middle, min, max);
    }
    return { min, middle, max };
}

export function stepServoRange(range, field, deltaY, shiftKey = false, limits = SERVO_PULSE_LIMITS) {
    const current = normalizeServoRange(range, field, undefined, limits);
    if (!pulseFields.includes(field) || !Number.isFinite(deltaY) || deltaY === 0) return current;
    return normalizeServoRange({ ...current, [field]: current[field] + (deltaY < 0 ? 1 : -1) * (shiftKey ? 10 : 1) }, field, current, limits);
}

export function centerServoRange(range, limits = SERVO_PULSE_LIMITS) {
    const current = normalizeServoRange(range, undefined, undefined, limits);
    const halfSpan = Math.min(Math.round((current.max - current.min) / 2), current.middle - limits.min, limits.max - current.middle);
    return { min: current.middle - halfSpan, middle: current.middle, max: current.middle + halfSpan };
}

export function isServoRangeValid(range, limits = SERVO_PULSE_LIMITS) {
    return pulseFields.every(field => Number.isInteger(range[field])) &&
        range.min >= limits.min && range.max <= limits.max && range.min <= range.middle && range.middle <= range.max;
}
export function isServoRangeCentered(range) { return range.middle * 2 === range.min + range.max; }

// Native non-passive wheel listeners prevent both page scrolling and native number stepping.
// onChange is the tab's normal configuration-change path, invoked once per transaction.
export function bindServoPulseControls(table, onChange, translate) {
    const states = new Map();
    const listeners = [];
    function listen(element, name, handler, options) {
        element.addEventListener(name, handler, options);
        listeners.push(() => element.removeEventListener(name, handler, options));
    }
    function read(state) {
        return Object.fromEntries(pulseFields.map(field => {
            const raw = state.inputs[field].value;
            return [field, raw.trim() === '' ? NaN : Number(raw)];
        }));
    }
    function refresh(state) {
        const range = read(state), valid = isServoRangeValid(range);
        const asymmetric = valid && !isServoRangeCentered(range);
        state.button.classList.toggle('is-asymmetric', asymmetric);
        state.button.disabled = !valid;
        state.button.title = translate(!valid ? 'servosCenterRangeInvalid' : asymmetric ? 'servosCenterRangeNeeded' : 'servosCenterRangeCentered');
        state.button.setAttribute('aria-label', translate('servosCenterRange'));
    }
    function write(state, range) {
        pulseFields.forEach(field => { state.inputs[field].value = range[field]; });
        state.previous = range;
        refresh(state);
    }
    for (const row of table.querySelectorAll('tr:not(.main)')) {
        const inputs = Object.fromEntries(pulseFields.map(field => [field, row.querySelector(`td.${field} input`)]));
        const button = row.querySelector('.servo-center-range');
        if (!button || pulseFields.some(field => !inputs[field])) continue;
        const state = { inputs, button };
        state.previous = normalizeServoRange(read(state));
        states.set(row, state);
        for (const field of pulseFields) {
            const input = inputs[field];
            input.min = SERVO_PULSE_LIMITS.min; input.max = SERVO_PULSE_LIMITS.max; input.step = 1;
            input.title = translate('servosPulseWheelHelp');
            listen(input, 'input', () => refresh(state));
            listen(input, 'wheel', event => {
                event.preventDefault();
                // Some platforms turn Shift + vertical wheel into a horizontal delta.
                const delta = event.deltaY || (event.shiftKey ? event.deltaX : 0);
                if (input.disabled || input.readOnly || !delta || !Number.isFinite(delta)) return;
                const before = read(state);
                const current = normalizeServoRange(before, field, state.previous);
                const after = stepServoRange(current, field, delta, event.shiftKey);
                write(state, after);
                if (pulseFields.some(key => before[key] !== after[key])) onChange(input);
            }, { passive: false });
        }
        listen(button, 'click', event => {
            event.preventDefault();
            if (button.disabled) return;
            const before = read(state), after = centerServoRange(before);
            write(state, after);
            if (pulseFields.some(field => before[field] !== after[field])) onChange();
        });
        refresh(state);
    }
    return {
        commitInput(input) {
            const state = states.get(input?.closest('tr'));
            if (!state) return;
            const field = pulseFields.find(key => state.inputs[key] === input);
            if (field) write(state, normalizeServoRange(read(state), field, state.previous));
        },
        commitAll() { for (const state of states.values()) write(state, normalizeServoRange(read(state), undefined, state.previous)); },
        dispose() { listeners.forEach(remove => remove()); states.clear(); },
    };
}

// Serialize existing servo MSP batches. Live writes never invoke the EEPROM chain;
// a requested save waits for the in-flight live batch and reads the latest UI values.
export function createServoUpdateQueue({ liveEnabled, applyLive, applySave }) {
    let active = true, busy = false, livePending = false, savePending = null, saving = false;
    function pump() {
        if (!active || busy) return;
        if (savePending !== null) {
            const reboot = savePending;
            savePending = null; livePending = false; busy = true;
            applySave(reboot, () => { busy = false; saving = false; pump(); });
        } else if (livePending) {
            livePending = false;
            if (!liveEnabled()) return;
            busy = true;
            applyLive(() => { busy = false; pump(); });
        }
    }
    return {
        live() { if (active) { livePending = true; pump(); } },
        save(reboot = false) {
            if (!active || saving) return;
            saving = true; savePending = reboot; livePending = false; pump();
        },
        cancel() { active = false; livePending = false; savePending = null; },
    };
}

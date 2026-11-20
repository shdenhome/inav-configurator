import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVO_PULSE_LIMITS, normalizeServoRange, stepServoRange, centerServoRange, isServoRangeValid, isServoRangeCentered, createServoUpdateQueue } from '../js/servoOutputControls.js';

const normal = () => ({ min: 1000, middle: 1500, max: 2000 });
test('firmware INAV 10 pulse limits are 500–2500 µs', () => {
    assert.deepEqual(SERVO_PULSE_LIMITS, { min: 500, max: 2500 });
});
test('every pulse field steps by one or ten microseconds, independent of wheel delta magnitude', () => {
    for (const field of ['min', 'middle', 'max']) for (const shift of [false, true]) {
        for (const delta of [-1, -120, 1, 120]) {
            const result = stepServoRange(normal(), field, delta, shift);
            assert.equal(result[field], normal()[field] + Math.sign(-delta) * (shift ? 10 : 1));
            for (const other of ['min', 'middle', 'max'].filter(key => key !== field)) assert.equal(result[other], normal()[other]);
        }
    }
});
test('wheel clamps the three fields to firmware limits and to each other', () => {
    const edges = { min: 500, middle: 1500, max: 2500 };
    assert.equal(stepServoRange(edges, 'min', 1, true).min, 500);
    assert.equal(stepServoRange(edges, 'max', -1, true).max, 2500);
    assert.equal(stepServoRange({ ...edges, min: 1499 }, 'min', -1, true).min, 1500);
    assert.equal(stepServoRange({ ...edges, max: 1501 }, 'max', 1, true).max, 1500);
    assert.equal(stepServoRange({ min: 1499, middle: 1500, max: 1501 }, 'middle', -1, true).middle, 1501);
    assert.equal(stepServoRange({ min: 1499, middle: 1500, max: 1501 }, 'middle', 1, true).middle, 1499);
});
test('manual edits are integer, ordered and clamped without changing a valid Mid for endpoint edits', () => {
    assert.deepEqual(normalizeServoRange({ ...normal(), min: 2100 }, 'min'), { min: 1500, middle: 1500, max: 2000 });
    assert.deepEqual(normalizeServoRange({ ...normal(), max: 900 }, 'max'), { min: 1000, middle: 1500, max: 1500 });
    assert.equal(normalizeServoRange({ ...normal(), middle: 2501 }, 'middle').middle, 2000);
    assert.deepEqual(normalizeServoRange({ min: '', middle: NaN, max: Infinity }, undefined, normal()), normal());
    assert.equal(normalizeServoRange({ ...normal(), middle: 1540.4 }, 'middle').middle, 1540);
});
test('centering preserves the specified half-span around Mid', () => {
    assert.deepEqual(centerServoRange({ min: 1000, middle: 1540, max: 2000 }), { min: 1040, middle: 1540, max: 2040 });
    assert.deepEqual(centerServoRange(normal()), normal());
    assert.equal(isServoRangeCentered({ min: 1000, middle: 1540, max: 2000 }), false);
    assert.equal(isServoRangeCentered(centerServoRange({ min: 1000, middle: 1540, max: 2000 })), true);
});
test('centering reduces span symmetrically at either firmware limit and supports odd/zero spans', () => {
    assert.deepEqual(centerServoRange({ min: 500, middle: 600, max: 2500 }), { min: 500, middle: 600, max: 700 });
    assert.deepEqual(centerServoRange({ min: 500, middle: 2400, max: 2500 }), { min: 2300, middle: 2400, max: 2500 });
    assert.deepEqual(centerServoRange({ min: 1000, middle: 1500, max: 2001 }), { min: 999, middle: 1500, max: 2001 });
    assert.deepEqual(centerServoRange({ min: 500, middle: 500, max: 2500 }), { min: 500, middle: 500, max: 500 });
    assert.deepEqual(centerServoRange({ min: 1600, middle: 1600, max: 1600 }), { min: 1600, middle: 1600, max: 1600 });
});
test('all tested positions retain ordering and exact symmetry after centering', () => {
    for (let middle = 500; middle <= 2500; middle += 7) {
        const range = { min: 500, middle, max: 2500 };
        for (const field of ['min', 'middle', 'max']) for (const delta of [-1, 1]) assert.ok(isServoRangeValid(stepServoRange(range, field, delta, true)));
        const centered = centerServoRange(range);
        assert.ok(isServoRangeValid(centered)); assert.ok(isServoRangeCentered(centered));
    }
});
test('zero, horizontal and nonfinite wheel delta do not change values', () => {
    for (const delta of [0, NaN, Infinity]) assert.deepEqual(stepServoRange(normal(), 'middle', delta), normal());
});

function queueFixture() {
    const events = [], callbacks = []; let enabled = true;
    const queue = createServoUpdateQueue({
        liveEnabled: () => enabled,
        applyLive(done) { events.push('live'); callbacks.push(done); },
        applySave(reboot, done) { events.push(reboot ? 'save-reboot' : 'save'); callbacks.push(done); },
    });
    return { queue, events, finish: () => callbacks.shift()(), disable: () => { enabled = false; } };
}
test('disabled Live Mode produces no writes and does not perform a save', () => {
    const f = queueFixture(); f.disable(); f.queue.live(); assert.deepEqual(f.events, []);
});
test('in-flight live batches never overlap, and repeated pending requests coalesce', () => {
    const f = queueFixture(); f.queue.live(); f.queue.live(); f.queue.live();
    assert.deepEqual(f.events, ['live']); f.finish(); assert.deepEqual(f.events, ['live', 'live']);
    f.finish(); assert.deepEqual(f.events, ['live', 'live']);
});
test('save waits for live completion, supersedes pending live and is not duplicated', () => {
    const f = queueFixture(); f.queue.live(); f.queue.live(); f.queue.save(); f.queue.save();
    assert.deepEqual(f.events, ['live']); f.finish(); assert.deepEqual(f.events, ['live', 'save']);
    f.finish(); assert.deepEqual(f.events, ['live', 'save']);
});
test('save and reboot is distinct and accepts new live edits only after a completed normal save', () => {
    const f = queueFixture(); f.queue.save(); f.queue.live();
    assert.deepEqual(f.events, ['save']); f.finish(); assert.deepEqual(f.events, ['save', 'live']);
    f.finish(); f.queue.save(true); assert.deepEqual(f.events, ['save', 'live', 'save-reboot']);
});
test('cleanup cancels queued writes and completion after cleanup cannot send more', () => {
    const f = queueFixture(); f.queue.live(); f.queue.live(); f.queue.save(true); f.queue.cancel(); f.finish();
    f.queue.live(); f.queue.save(); assert.deepEqual(f.events, ['live']);
});
test('disabling live during a batch prevents an already queued live batch from starting', () => {
    const f = queueFixture(); f.queue.live(); f.queue.live(); f.disable(); f.finish(); assert.deepEqual(f.events, ['live']);
});

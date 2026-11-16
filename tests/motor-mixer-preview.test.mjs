import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMotorPreviewLabels } from '../js/motorMixerPreview.js';

const rule = (roll, pitch, throttle = 1) => ({ getRoll: () => roll, getPitch: () => pitch, getThrottle: () => throttle });
const quad = [rule(-1, 1), rule(-1, -1), rule(1, 1), rule(1, -1)];

test('a prepended pusher shifts outputs without changing Quad X base numbers', () => {
    assert.deepEqual(getMotorPreviewLabels(quad, [rule(0, 0), ...quad],
        ['Motor 1', 'Motor 2', 'Motor 3', 'Motor 4', 'Motor 5']), [
        { baseNumber: 1, outputs: ['S2'] }, { baseNumber: 2, outputs: ['S3'] },
        { baseNumber: 3, outputs: ['S4'] }, { baseNumber: 4, outputs: ['S5'] },
    ]);
});

test('reordered rules follow nonsequential physical output assignments', () => {
    const result = getMotorPreviewLabels(quad, [quad[3], quad[0], quad[2], quad[1]],
        ['Servo 1', 'Motor 3', 'Motor 1', '-', 'Motor 4', 'Motor 2']);
    assert.deepEqual(result.map(label => label.outputs), [['S6'], ['S5'], ['S2'], ['S3']]);
});

test('missing motors retain schematic numbers and show no assigned output', () => {
    assert.deepEqual(getMotorPreviewLabels(quad, [quad[1]], ['Motor 1']).map(label => label.outputs),
        [[], ['S1'], [], []]);
});

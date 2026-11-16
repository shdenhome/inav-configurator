import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const collectionPath = resolve('js/motorMixerRuleCollection.js');
const collectionSource = readFileSync(collectionPath, 'utf8')
    .replace("import MotorMixRule from './motorMixRule';\n", '');
const collectionUrl = 'data:text/javascript;base64,' + Buffer.from(collectionSource).toString('base64');
const { default: MotorMixerRuleCollection } = await import(collectionUrl);

function rule(throttle, roll = 0, pitch = 0, yaw = 0) {
    return {
        throttle, roll, pitch, yaw,
        getThrottle() { return this.throttle; },
        getRoll() { return this.roll; },
        getPitch() { return this.pitch; },
        getYaw() { return this.yaw; },
    };
}

test('inserts a new motor rule before existing rules without changing their order or values', () => {
    const rules = new MotorMixerRuleCollection();
    rules.setMotorCount(4);
    const first = rule(0.7, 0.1, 0.2, 0.3);
    const second = rule(0.8, -0.1, -0.2, -0.3);
    const inserted = rule(1, 0, 0, 0);
    rules.put(first);
    rules.put(second);

    assert.equal(rules.insertAtStart(inserted), true);
    assert.deepEqual(rules.get(), [inserted, first, second]);
    assert.deepEqual(rules.get().map(item => [item.getThrottle(), item.getRoll(), item.getPitch(), item.getYaw()]), [
        [1, 0, 0, 0],
        [0.7, 0.1, 0.2, 0.3],
        [0.8, -0.1, -0.2, -0.3],
    ]);

    const appended = rule(0.9);
    rules.put(appended);
    assert.equal(rules.get().at(-1), appended);
});

test('does not insert or change existing rules when the motor slots are full', () => {
    const rules = new MotorMixerRuleCollection();
    rules.setMotorCount(2);
    const first = rule(0.7, 0.1, 0.2, 0.3);
    const second = rule(0.8, -0.1, -0.2, -0.3);
    rules.put(first);
    rules.put(second);

    assert.equal(rules.insertAtStart(rule(1)), false);
    assert.deepEqual(rules.get(), [first, second]);
});

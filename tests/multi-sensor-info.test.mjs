import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMultiSensorInfo, remainingSensorNames } from '../js/multiSensorInfo.js';
const packet = [1,1,1,0,0,0,77,83,1,3,0,8,3,8,3,7,3];
const view = bytes => new DataView(Uint8Array.from(bytes).buffer);
const names = {8:'ICM42605',3:'MPU6500'};
const baroNames = {3:'MS5611',7:'SPL06'};
test('multi-sensor tail parses active modes and physical tags', () => {
    assert.deepEqual(parseMultiSensorInfo(view(packet)), {imuEnabled:true,baroEnabled:true,primaryImuTag:0,accelerometers:[8,3,8],barometers:[3,7],primaryBarometer:3});
});
test('legacy, truncated and unrelated sensor-config tails are ignored', () => {
    assert.equal(parseMultiSensorInfo(view(packet.slice(0,6))),null);
    assert.equal(parseMultiSensorInfo(view(packet.slice(0,16))),null);
    const unknown = [...packet]; unknown[8]=2;
    assert.equal(parseMultiSensorInfo(view(unknown)),null);
    unknown[8]=1; unknown[6]=0;
    assert.equal(parseMultiSensorInfo(view(unknown)),null);
});
test('mode flags are independent and a valid prefix can have future trailing bytes', () => {
    const bytes=[...packet,0]; bytes[9]=2;
    const info=parseMultiSensorInfo(view(bytes));
    assert.equal(info.imuEnabled,false); assert.equal(info.baroEnabled,true);
});
test('selecting ICM42605 removes one device and retains the other ICM42605', () => {
    assert.deepEqual(remainingSensorNames([8,3,8],'8',0,names),['MPU6500','ICM42605']);
});
test('selecting MPU6500 displays both remaining ICM42605 devices', () => {
    assert.deepEqual(remainingSensorNames([8,3,8],'3',0,names),['ICM42605','ICM42605']);
});
test('AUTO uses the real primary physical tag instead of an assumed first device', () => {
    assert.deepEqual(remainingSensorNames([8,3,8],'1',2,names),['ICM42605','MPU6500']);
});
test('barometer type changes swap the other detected type', () => {
    assert.deepEqual(remainingSensorNames([3,7],'3',0,baroNames),['SPL06']);
    assert.deepEqual(remainingSensorNames([3,7],'7',0,baroNames),['MS5611']);
});
test('missing devices and one-device configurations produce no invented types', () => {
    assert.deepEqual(remainingSensorNames([0,3,0],'1',0,names),[]);
    assert.deepEqual(remainingSensorNames([],'1',255,names),[]);
});
test('unknown hardware preserves the source ID rather than inventing a model', () => {
    assert.deepEqual(remainingSensorNames([8,200],'8',0,names),['#200']);
});

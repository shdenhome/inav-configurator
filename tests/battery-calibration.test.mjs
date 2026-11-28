import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATTERY_CALIBRATIONS, parseCalibrationReference, calculateBatteryScale, createBatteryCalibrationController } from '../js/batteryCalibration.js';
const error = code => e => e?.code === 'batteryCalibration' + code;
function fixture() {
    const state = Object.fromEntries(Object.keys(BATTERY_CALIBRATIONS).map(key => [key, {
        scale: key === 'current1' ? 250 : key === 'current2' ? 2 : 1000,
        value: key.startsWith('current') ? 2 : 20, offset: key === 'voltage2' ? 1 : 0,
        sensor: key.endsWith('1') ? 'ADC' : 'I2C', enabled: true, raw: true,
    }]));
    const form = structuredClone(state), writes = [], changed = [];
    let active = true;
    const io = {
        isActive: () => active,
        getUi: key => form[key],
        readSnapshot: async key => ({ ...state[key] }),
        readScale: async key => state[key].scale,
        writeScale: async (key, scale) => { writes.push([key, scale]); state[key].scale = scale; },
        setScale: (key, scale) => { changed.push([key, scale]); form[key].scale = scale; },
        sleep: async () => {},
    };
    return { state, form, io, writes, changed, stop() { active = false; } };
}
test('reference accepts decimal comma, fractions and exponent without accepting junk/nonpositive values', () => {
    for (const [input, result] of [['19,80',19.8],['.5',.5],['  +2.5e1 ',25]]) assert.equal(parseCalibrationReference(input),result);
    for (const input of ['', ' ', '-1', '0', 'NaN', 'Infinity', '1e999', '1.2.3', '1,2.3', '12A', '0x20', null, undefined, false])
        assert.throws(() => parseCalibrationReference(input), error('InvalidInput'));
});
test('four channels use real direct/inverse formulas, retaining battery2 voltage offset', () => {
    assert.equal(calculateBatteryScale('voltage1',{scale:1100,value:20},22),1210);
    assert.equal(calculateBatteryScale('current1',{scale:250,value:2},4),125);
    assert.equal(calculateBatteryScale('voltage2',{scale:1000,value:20,offset:1},21),1053);
    assert.equal(calculateBatteryScale('voltage2',{scale:1000,value:20,offset:-1},21),1048);
    assert.equal(calculateBatteryScale('current2',{scale:2,value:4},2),4);
    assert.equal(calculateBatteryScale('current1',{scale:-250,value:2},4),-125);
});
test('invalid samples, zero contribution and unrepresentable coefficients cannot produce a scale', () => {
    for (const value of [0,-1,NaN,Infinity]) assert.throws(()=>calculateBatteryScale('voltage1',{scale:1000,value},20),error('NoSample'));
    assert.throws(()=>calculateBatteryScale('current1',{scale:250,value:-2},4),error('NoSample'));
    assert.throws(()=>calculateBatteryScale('voltage2',{scale:1000,value:1,offset:1},2),error('NoSample'));
    assert.throws(()=>calculateBatteryScale('voltage2',{scale:1000,value:.5,offset:1},.75),error('NoSample'));
    assert.throws(()=>calculateBatteryScale('voltage2',{scale:1000,value:20,offset:1},.5),error('Range'));
    assert.throws(()=>calculateBatteryScale('current2',{scale:2,value:2},100),error('Range'));
    assert.throws(()=>calculateBatteryScale('voltage1',{scale:65535,value:1},2),error('Range'));
});
test('each calibration changes only its own scale and displays actual telemetry, not the reference', async () => {
    for (const [key,reference,expected] of [['voltage1',22,1100],['current1',4,125],['voltage2',21,1053],['current2',1,4]]) {
        const f=fixture(), before=structuredClone(f.state),controller=createBatteryCalibrationController(f.io);
        const result=await controller.apply(key,reference);
        assert.deepEqual(f.writes,[[key,expected]]);assert.deepEqual(f.changed,[[key,expected]]);
        assert.equal(result.value,before[key].value);assert.notEqual(result.value,reference);
        before[key].scale=expected;assert.deepEqual(f.state,before);assert.deepEqual(f.form,before);
    }
});
test('invalid reference, missing sample and unsaved relevant fields cause no writes', async () => {
    const f=fixture(), c=createBatteryCalibrationController(f.io);
    await assert.rejects(c.apply('voltage1',''),error('InvalidInput'));
    f.state.voltage1.value=0;await assert.rejects(c.apply('voltage1',20),error('NoSample'));
    f.state.voltage1.value=20;f.form.voltage1.scale=1200;
    await assert.rejects(c.apply('voltage1',21),error('Unsaved'));
    assert.deepEqual(f.writes,[]);assert.deepEqual(f.changed,[]);
});
test('CAN, first INA226 and sag compensation cannot calibrate these scales', async () => {
    for (const [key,mode] of [['voltage1','INA226'],['current1','INA226'],['voltage2','CAN'],['current2','CAN']]) {
        const f=fixture();f.state[key].sensor=f.form[key].sensor=mode;
        await assert.rejects(createBatteryCalibrationController(f.io).apply(key,21),error('Unsupported'));assert.deepEqual(f.writes,[]);
    }
    const f=fixture();f.state.voltage1.raw=f.form.voltage1.raw=false;
    await assert.rejects(createBatteryCalibrationController(f.io).apply('voltage1',21),error('Unsupported'));
});
test('unchanged quantized scale does not dispatch a write', async () => {
    const f=fixture();const result=await createBatteryCalibrationController(f.io).apply('current2',2.01);
    assert.equal(result.unchanged,true);assert.deepEqual(f.writes,[]);
});
test('readback resolves a missing ACK only when the new value is actually present', async () => {
    const f=fixture();f.io.writeScale=async(key,scale)=>{f.state[key].scale=scale;throw Error('ACK lost');};
    assert.equal((await createBatteryCalibrationController(f.io).apply('voltage1',22)).scale,1100);
    const n=fixture();n.io.writeScale=async()=>{throw Error('refused');};
    await assert.rejects(createBatteryCalibrationController(n.io).apply('voltage1',22),error('Communication'));assert.deepEqual(n.changed,[]);
});
test('unconfirmed write is reported, not silently accepted or rolled back', async () => {
    const f=fixture();let uncertain=false;f.io.readScale=async()=>{throw Error('offline');};f.io.markUnconfirmed=()=>{uncertain=true;};f.io.isWritePending=()=>uncertain;
    const c=createBatteryCalibrationController(f.io);await assert.rejects(c.apply('voltage1',22),error('Unconfirmed'));
    assert.equal(uncertain,true);assert.deepEqual(f.changed,[]);assert.equal(f.writes.length,1);
    await assert.rejects(c.apply('current1',4),error('Unconfirmed'));assert.equal(f.writes.length,1);
});
test('cancel before dispatch and tab cleanup prevent writes', async () => {
    const f=fixture();const c=createBatteryCalibrationController(f.io);
    await assert.rejects(c.apply('voltage1',22,()=>false),error('Communication'));
    f.stop();await assert.rejects(c.apply('voltage1',22),error('Communication'));assert.deepEqual(f.writes,[]);
});
test('simultaneous apply is serialized while waiting for filter settling', async () => {
    const f=fixture();let release;f.io.sleep=()=>new Promise(r=>{release=r;});const c=createBatteryCalibrationController(f.io);
    const p=c.apply('voltage1',22);while(!release)await new Promise(r=>setImmediate(r));
    await assert.rejects(c.apply('current1',4),error('Settling'));assert.equal(c.busy,true);release();await p;assert.equal(c.busy,false);assert.equal(f.writes.length,1);
});
test('confirmed RAM scale is kept when post-write live telemetry is unavailable', async () => {
    const f=fixture();let calls=0;f.io.readSnapshot=async key=>{if(++calls>1)throw Error('sample missing');return {...f.state[key]};};
    const result=await createBatteryCalibrationController(f.io).apply('voltage1',22);
    assert.deepEqual(result,{scale:1100,value:null,pending:true});assert.equal(f.form.voltage1.scale,1100);
});


test('old-session write completion does not read or poison a replacement connection', async () => {
    const f = fixture();let reads = 0, marked = false;
    f.io.writeScale = async () => { f.stop(); throw Error('previous connection closed'); };
    f.io.readScale = async () => { reads++; throw Error('must not contact new session'); };
    f.io.markUnconfirmed = () => { marked = true; };
    const result = await createBatteryCalibrationController(f.io).apply('voltage1', 22);
    assert.equal(result.pending, true);assert.equal(reads, 0);assert.equal(marked, false);assert.deepEqual(f.changed, []);
});

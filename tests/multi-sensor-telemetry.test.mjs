import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMultiSensorTelemetry, multiSensorGraphSeries, createMultiSensorCsvSchema, readMultiSensorTelemetry } from '../js/multiSensorTelemetry.js';

export function packet() {
    const data = new DataView(new ArrayBuffer(211)); let o = 0;
    const u8=v=>data.setUint8(o++,v),u16=v=>{data.setUint16(o,v,true);o+=2;},u32=v=>{data.setUint32(o,v,true);o+=4;},i32=v=>{data.setInt32(o,v,true);o+=4;};
    u8(1);u8(3);u8(3);u8(2);u32(100000);
    for(let i=0;i<3;i++) { u8(i);u8(i===1?3:8);u8(127);u16(900);u16(800);u32(200);u32(400);[1250,-2500,3750,125,-250,1000,0,0,1250].forEach(i32); }
    for(let i=0;i<2;i++) { u8(i);u8(i?7:3);u8(15);u16(990);u32(10000);i32(100000+i*10);i32(99930+i*10);i32(i?2534:-1200);i32(i?456:-123); }
    assert.equal(o,211);return data;
}
const snapshot=()=>parseMultiSensorTelemetry(packet(),1000);
test('state packet contains all physical devices, signed units and independent quality',()=>{
    const s=snapshot();assert.equal(s.timestampUs,100000);assert.equal(s.imus.length,3);assert.equal(s.barometers.length,2);
    assert.deepEqual(s.imus[1].gyro,[1.25,-2.5,3.75]);assert.deepEqual(s.imus[2].acc,[0.125,-0.25,1]);
    assert.equal(s.barometers[0].temperatureC,-12);assert.equal(s.barometers[1].temperatureC,25.34);
    assert.equal(s.barometers[0].altitudeM,-1.23);assert.equal(s.barometers[1].altitudeM,4.56);
});
test('legacy, truncated, unknown version, duplicate tags and impossible confidence are rejected',()=>{
    for(const len of [0,6,17,210]) assert.equal(parseMultiSensorTelemetry(new DataView(new ArrayBuffer(len))),null);
    const version=packet();version.setUint8(0,2);assert.equal(parseMultiSensorTelemetry(version),null);
    const dup=packet();dup.setUint8(59,0);assert.equal(parseMultiSensorTelemetry(dup),null);
    const trust=packet();trust.setUint16(11,1001,true);assert.equal(parseMultiSensorTelemetry(trust),null);
});
test('one group produces all three gyro/accelerometer series and two barometer series',()=>{
    const s=snapshot();assert.equal(multiSensorGraphSeries(s,'gyro',1000).length,3);
    assert.equal(multiSensorGraphSeries(s,'acc',1000).length,3);
    const b=multiSensorGraphSeries(s,'baro',1000);assert.equal(b.length,2);assert.equal(b[0].values[0],-1.23);assert.equal(b[1].name,'SPL06');
});
test('loss keeps the physical trace but produces gaps instead of zero readings',()=>{
    const s=snapshot();s.imus[1].flags=1;
    const g=multiSensorGraphSeries(s,'gyro',1000);assert.equal(g.length,3);assert.equal(g[1].index,1);assert.ok(g[1].values.every(Number.isNaN));
    s.barometers[0].flags=1;assert.ok(Number.isNaN(multiSensorGraphSeries(s,'baro',1000)[0].values[0]));
});
test('uncalibrated accelerometers show explicit raw values and a calibration state',()=>{
    const s=snapshot();s.imus[0].flags=1|16;
    const a=multiSensorGraphSeries(s,'acc',1000)[0];assert.equal(a.calibrated,false);assert.equal(a.valid,true);assert.deepEqual(a.values,[0,0,1.25]);
});
test('stale host snapshots are not displayed as live measurements',()=>{
    const g=multiSensorGraphSeries(snapshot(),'acc',2500);assert.ok(g.every(s=>s.values.every(Number.isNaN)));
    assert.deepEqual(multiSensorGraphSeries(null,'acc'),[]);
});
test('CSV headers stay fixed, include all sources, and invalid values are blank',()=>{
    const schema=createMultiSensorCsvSchema({imu:true,baro:true});const s=snapshot();
    const values=schema.values(s);assert.equal(schema.headers.length,86);assert.equal(values.length,86);
    assert.equal(new Set(schema.headers).size,86);
    const row=Object.fromEntries(schema.headers.map((h,i)=>[h,values[i]]));
    assert.equal(row.imu2_type,'MPU6500');assert.equal(row.imu3_acc_z_g,1);assert.equal(row.baro2_type,'SPL06');assert.equal(row.baro1_temperature_c,-12);
    s.imus[1].flags=1;s.barometers[0].flags=1;
    const bad=Object.fromEntries(schema.headers.map((h,i)=>[h,schema.values(s)[i]]));
    assert.equal(bad.imu2_gyro_x_dps,'');assert.equal(bad.imu2_gyro_valid,0);assert.equal(bad.baro1_altitude_m,'');
    assert.equal(schema.values(null).length,schema.headers.length);assert.ok(schema.values(null).every(x=>x===''));
});
test('CSV obeys the existing type selection and does not invent disabled groups',()=>{
    const imu=createMultiSensorCsvSchema({imu:true,baro:false});assert.equal(imu.headers.length,64);assert.ok(!imu.headers.some(x=>x.startsWith('baro')));
    const baro=createMultiSensorCsvSchema({imu:false,baro:true});assert.equal(baro.headers.length,23);assert.ok(!baro.headers.some(x=>x.startsWith('imu')));
    assert.deepEqual(createMultiSensorCsvSchema({imu:false,baro:false}).headers,[]);
});
test('telemetry requests settle on unsupported firmware, queue rejection and timeout',async()=>{
    assert.equal(await readMultiSensorTelemetry({send_message:(c,a,b,done)=>done(false)},10),null);
    assert.equal(await readMultiSensorTelemetry({send_message:(c,a,b,done)=>done({data:new DataView(new ArrayBuffer(0))})},10),null);
    assert.equal(await readMultiSensorTelemetry({send_message:()=>{}},5),null);
    assert.equal(await readMultiSensorTelemetry({send_message:()=>{throw Error('closed');}},5),null);
});

test('barometer pressure remains visible before ground calibration, height is unavailable',()=>{
    const s=snapshot();s.barometers[0].flags &= ~4;
    const b=multiSensorGraphSeries(s,'baro',1000)[0];
    assert.equal(b.valid,true);assert.equal(b.calibrated,false);assert.equal(b.pressurePa,100000);assert.ok(Number.isNaN(b.values[0]));
});

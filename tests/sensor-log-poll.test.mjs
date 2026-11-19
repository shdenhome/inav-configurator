import { test } from 'node:test';
import assert from 'node:assert/strict';
import MSPCodes from '../js/msp/MSPCodes.js';
import { createLegacyLogSchema, createSensorLogPoll, createSensorLogWriter } from '../js/sensorLogPoll.js';
function state() {return {RC:{active_channels:2,channels:[1000,1500]},MOTOR_DATA:[1200,1300],SENSOR_DATA:{gyroscope:[1,2,3],accelerometer:[4,5,6],magnetometer:[7,8,9],kinematics:[10,11,12],altitude:13,debug:[14,15]},GPS_DATA:{fix:1,numSat:10,lat:550000000,lon:370000000,alt:100,speed:20,ground_course:30},ANALOG:{voltage:20,amperage:2,mAhdrawn:100,rssi:99}};}
test('CSV takes a sample only after all requested MSP callbacks have updated state',async()=>{
 const FC=state();const callbacks=new Map();let samples=0;
 const schema=createLegacyLogSchema(['MSP_RAW_IMU','MSP_ALTITUDE'],FC);
 const poll=createSensorLogPoll({send_message:(c,a,b,done)=>callbacks.set(c,done)},[MSPCodes.MSP_RAW_IMU,MSPCodes.MSP_ALTITUDE],false,(s,success)=>{samples++;assert.equal(schema.values(success)[0],100);assert.equal(schema.values(success)[9],200);});
 const pending=poll.poll();assert.equal(await poll.poll(),false);
 FC.SENSOR_DATA.gyroscope[0]=100;callbacks.get(MSPCodes.MSP_RAW_IMU)({length:18});await Promise.resolve();assert.equal(samples,0);
 FC.SENSOR_DATA.altitude=200;callbacks.get(MSPCodes.MSP_ALTITUDE)({length:10});assert.equal(await pending,true);assert.equal(samples,1);
});
test('stopping a poll prevents late callbacks from appending rows',async()=>{
 let done,count=0;const poll=createSensorLogPoll({send_message:(c,a,b,cb)=>done=cb},[1],false,()=>count++);
 const pending=poll.poll();poll.cancel();done({length:1});await pending;assert.equal(count,0);assert.equal(await poll.poll(),false);
});
test('failed requests produce empty legacy columns and keep the row width',async()=>{
 const FC=state();const schema=createLegacyLogSchema(['MSP_RAW_IMU','MSP_ALTITUDE'],FC);
 const poll=createSensorLogPoll({send_message:(code,a,b,done)=>done(code===MSPCodes.MSP_RAW_IMU?false:{length:10})},[MSPCodes.MSP_RAW_IMU,MSPCodes.MSP_ALTITUDE],false,(s,success)=>{const row=schema.values(success);assert.equal(row.length,10);assert.ok(row.slice(0,9).every(v=>v===''));assert.equal(row[9],13);});
 await poll.poll();
});
test('one shared extra request serves IMU and barometer logging',async()=>{
 const requested=[];const poll=createSensorLogPoll({send_message:(code,a,b,done)=>{requested.push(code);done({length:0,data:new DataView(new ArrayBuffer(0))});}},[1,1,2],true,snapshot=>assert.equal(snapshot,null));
 await poll.poll();assert.deepEqual(requested,[1,2,MSPCodes.MSP2_INAV_MULTI_SENSOR_STATE]);
});
test('legacy CSV column names and fixed RC/motor/debug counts are preserved',()=>{
 const FC=state();const props=['MSP_RAW_IMU','MSP_ATTITUDE','MSP_ALTITUDE','MSP_RAW_GPS','MSP_ANALOG','MSP_RC','MSP_MOTOR','MSP_DEBUG'];
 const schema=createLegacyLogSchema(props,FC);const successful=new Set(props.map(k=>MSPCodes[k]));
 assert.equal(schema.headers.length,30);assert.equal(schema.headers[0],'gyroscopeX');assert.ok(schema.headers.includes('RC1'));
 FC.RC.channels=[1000];FC.MOTOR_DATA=[1200,1300,1400];
 const values=schema.values(successful);assert.equal(values.length,schema.headers.length);
 assert.equal(values[schema.headers.indexOf('RC1')],'');assert.equal(values[schema.headers.indexOf('gpsLat')],55);
});
test('queued appends preserve header, data and the final partial buffer order',async()=>{
 const completed=[],release=[];const writer=createSensorLogWriter(text=>new Promise(resolve=>release.push(()=>{completed.push(text);resolve();})));
 const first=writer.append(['timestamp,x','1,10']);const last=writer.append(['2,20']);await Promise.resolve();assert.equal(release.length,1);
 release.shift()();await first;await Promise.resolve();assert.equal(release.length,1);release.shift()();await last;
 assert.deepEqual(completed,['timestamp,x\n1,10\n','2,20\n']);await writer.finished();
});
test('write errors are reported without falsely counting saved rows',async()=>{
 let errors=0,written=0;const writer=createSensorLogWriter(async()=>{throw Error('disk');},()=>written++,()=>errors++);
 await assert.rejects(writer.append(['header']),/disk/);assert.equal(errors,1);assert.equal(written,0);
});

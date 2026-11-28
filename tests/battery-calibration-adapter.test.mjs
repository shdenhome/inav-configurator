import assert from 'node:assert/strict';import fs from 'node:fs';import{pathToFileURL}from'node:url';import path from'node:path';
import {test} from 'node:test';import{fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
test('production battery adapters use real setting encoders, isolate point writes, validate samples and cancel safely',async()=>{
const{installBatteryCalibration}=await import(pathToFileURL(path.join(root,'js/batteryCalibrationMsp.js')));
const state=new Map(),writes=[],requests=[];let dialog,active=true,analogFlag=0x10,malformed=false,featureMask=(1<<1)|(1<<11),token=1,writeMode="normal",rejectOldWrite,timeoutMode=false,battery2Sensor=0,battery2Present=true,battery2State=0,voltageWire=2000,currentWire=200;
const codes={MSP_FEATURE:36,MSPV2_INAV_ANALOG:0x2002,MSPV2_INAV_BATTERY2_CONFIG:0x20a1,MSPV2_INAV_BATTERY2_STATE:0x20a0,MSPV2_SET_SETTING:0x1004};
const settings={vbat_scale:1100,current_meter_scale:250,battery2_voltage_scale:1000,battery2_current_scale:2,vbat_meter_type:0,current_meter_type:0,bat_voltage_src:0,current_meter_offset:0};
function node(key){if(!state.has(key))state.set(key,{value:'',props:{},attrs:{},data:{},events:{}});return state.get(key)}
function $(key){if(typeof key==='object')return key;const n=node(key);return{val(v){if(v===undefined)return n.value;n.value=v;return this},prop(k,v){if(v===undefined)return n.props[k];n.props[k]=v;return this},attr(k,v){if(v===undefined)return n.attrs[k];n.attrs[k]=v;return this},data(k){return n.data[k]},on(event,...args){n.events[event]=args.at(-1);return this},off(){n.events={};return this}}}
for(const[id,value]of Object.entries({'#voltagescale':1100,'#currentscale':250,'#currentoffset':0,'#vbat_meter_type':0,'#current_meter_type':0,'#voltagesource':0,'#battery2-voltage-scale':1000,'#battery2-voltage-offset':1,'#battery2-current-scale':2,'#battery2-current-offset':0,'#battery2-voltage-sensor':0,'#battery2-current-sensor':0}))$(id).val(value);
for(const key of['#vbat_meter_type','#current_meter_type'])node(key).data['setting-info']={table:{values:['ADC','INA226']}};
for(const key of['.tab-configuration .feature[data-bit="1"]','.tab-configuration .feature[data-bit="11"]','#battery2-voltage-enabled','#battery2-current-enabled'])$(key).prop('checked',true);
function setting(name){return{value:settings[name],setting:{min:name==='current_meter_scale'?-10000:1,max:65535,table:{values:['ADC','INA226']}}}}
await import(pathToFileURL(path.join(root,'js/injected_methods.js')));
const encoderSource=fs.readFileSync(path.join(root,'js/msp/MSPHelper.js'),'utf8');
const extract=(start,end)=>encoderSource.slice(encoderSource.indexOf(start),encoderSource.indexOf(end,encoderSource.indexOf(start)));
const helper={getSetting:async name=>setting(name),_getSetting:async name=>({type:name==='current_meter_scale'?'int16_t':'uint16_t'})};
new Function('self',extract('    self._encodeSettingReference =','    self.getSetting =')+extract('    self.encodeSetting =','    self.setSetting ='))(helper);
const MSP={promise:async(code,data)=>{requests.push(code);if(code===codes.MSPV2_SET_SETTING){if(writeMode==='deferred')return new Promise((_,reject)=>rejectOldWrite=reject);if(writeMode==='lost')return new Promise(()=>{});const zero=data.indexOf(0);const name=String.fromCharCode(...data.slice(0,zero));const raw=data[zero+1]|data[zero+2]<<8;const value=name==='current_meter_scale'&&raw>=32768?raw-65536:raw;writes.push({name,value});settings[name]=value;return{data:new DataView(new ArrayBuffer(0))}}const view=new DataView(new ArrayBuffer(code===36?4:code===0x2002?(malformed?23:24):code===0x20a1?21:11));if(code===36)view.setUint32(0,featureMask,true);if(code===0x2002&&!malformed){view.setUint8(0,analogFlag);view.setUint16(1,voltageWire,true);view.setInt16(3,currentWire,true)}if(code===0x20a1){view.setUint16(0,settings.battery2_voltage_scale,true);view.setInt16(2,100,true);view.setUint16(4,settings.battery2_current_scale,true);view.setUint8(15,1);view.setUint8(16,battery2Sensor);view.setUint8(17,1);view.setUint8(18,battery2Sensor)}if(code===0x20a0){view.setUint8(0,battery2Present?1:0);view.setUint8(1,battery2State);view.setUint16(3,voltageWire,true);view.setInt16(5,currentWire,true)}return{data:view}}};
const FC={MISC:{},CURRENT_METER_CONFIG:{},BATTERY2:{config:{voltage_offset:100,current_offset:0,cells:5}}};const before=structuredClone(FC);
const create=()=>installBatteryCalibration({$,MSP,codes,helper,FC,i18n:{getMessage:k=>k},isActive:()=>active,sessionToken:()=>token,openDialog:options=>(dialog=options,{close(){options.onClose()}})});let handle=create();await handle.ready;
function open(key){const el=$('button:'+key);el.attr('data-battery-calibration',key).prop('disabled',false);node('[data-battery-calibration]').events['click.batteryCalibration'].call(el)}
open('voltage2');assert.equal((await dialog.read()).value,20);
const realTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>realTimeout(fn,ms===2000?0:timeoutMode&&(ms===4000||ms===15000)?5:ms,...args);
const result=await dialog.apply('21');assert.equal(result.scale,1053);assert.deepEqual(writes,[{name:'battery2_voltage_scale',value:1053}]);assert.equal(FC.BATTERY2.config.voltage_offset,100);assert.equal(FC.BATTERY2.config.cells,5);assert.deepEqual(FC.MISC,before.MISC);assert.deepEqual(FC.CURRENT_METER_CONFIG,before.CURRENT_METER_CONFIG);assert.ok(!requests.includes(250)&&!requests.includes(68));
open('current1');assert.equal((await dialog.read()).value,2);const current=await dialog.apply('4');assert.equal(current.scale,125);assert.equal(FC.CURRENT_METER_CONFIG.scale,125);
open('voltage1');malformed=true;await assert.rejects(dialog.read(),{code:'batteryCalibrationNoSample'});malformed=false;
$('#voltagescale').val(999);await assert.rejects(dialog.read(),{code:'batteryCalibrationUnsaved'});$('#voltagescale').val(1100);
$('#voltagesource').val(1);await assert.rejects(dialog.read(),{code:'batteryCalibrationUnsaved'});$('#voltagesource').val(0);
analogFlag=12;open('voltage1');await assert.rejects(dialog.read(),{code:'batteryCalibrationNoSample'});
open('current1');await assert.rejects(dialog.read(),{code:'batteryCalibrationNoSample'});
featureMask=1<<11;$('.tab-configuration .feature[data-bit="1"]').prop('checked',false);
assert.equal((await dialog.read()).value,2,'independent current monitor works when voltage disabled');
featureMask=(1<<1)|(1<<11);$('.tab-configuration .feature[data-bit="1"]').prop('checked',true);analogFlag=0x10;
settings.bat_voltage_src=1;$('#voltagesource').val(1);open('voltage1');await assert.rejects(dialog.read(),{code:'batteryCalibrationUnsupported'});settings.bat_voltage_src=0;$('#voltagesource').val(0);
settings.current_meter_type=1;$('#current_meter_type').val(1);open('current1');await assert.rejects(dialog.read(),{code:'batteryCalibrationUnsupported'});settings.current_meter_type=0;$('#current_meter_type').val(0);
open('voltage2');battery2Present=false;await assert.rejects(dialog.read(),{code:'batteryCalibrationNoSample'});battery2Present=true;
battery2State=3;await assert.rejects(dialog.read(),{code:'batteryCalibrationNoSample'});battery2State=0;
battery2Sensor=1;$('#battery2-voltage-sensor').val(1);await assert.rejects(dialog.read(),{code:'batteryCalibrationUnsupported'});
battery2Sensor=2;$('#battery2-voltage-sensor').val(2);$('#battery2-current-sensor').val(2);assert.equal((await dialog.read()).sensor,'ADC');open('current2');assert.equal((await dialog.read()).sensor,'ADC');
const current2Result=await dialog.apply('4');assert.equal(current2Result.scale,1);assert.equal(FC.BATTERY2.config.current_scale,1);assert.equal(FC.BATTERY2.config.voltage_scale,1053);
voltageWire=65535;open('voltage1');await assert.rejects(dialog.read(),{code:'batteryCalibrationNoSample'});open('voltage2');await assert.rejects(dialog.read(),{code:'batteryCalibrationNoSample'});voltageWire=2000;
currentWire=32767;open('current1');await assert.rejects(dialog.read(),{code:'batteryCalibrationNoSample'});open('current2');await assert.rejects(dialog.read(),{code:'batteryCalibrationNoSample'});currentWire=-1;await assert.rejects(dialog.read(),{code:'batteryCalibrationNoSample'});currentWire=200;
// Cancellation during metadata/encoding must prevent subsequent wire dispatch.
let releaseEncode,encoding=false;const normalEncode=helper.encodeSetting;
helper.encodeSetting=(name,value)=>new Promise(resolve=>{encoding=true;releaseEncode=()=>normalEncode.call(helper,name,value).then(resolve)});
open('voltage1');const beforeCancelWrites=writes.length;const canceled=dialog.apply('21').catch(e=>e);
for(let i=0;i<100&&!encoding;i++)await Promise.resolve();assert.ok(encoding);dialog.onClose();releaseEncode();await canceled;
assert.equal(writes.length,beforeCancelWrites,'Cancel before SET dispatch must not send late write');helper.encodeSetting=normalEncode;
// A previous connection's rejected write must not poison a fresh connection.
writeMode='deferred';open('voltage1');const oldApply=dialog.apply('21').catch(error=>error);
for(let i=0;i<100&&!rejectOldWrite;i++)await Promise.resolve();assert.ok(rejectOldWrite);
active=false;token++;const getSettingBefore=helper.getSetting;helper.getSetting=async()=>{throw Error('old disconnected read')};rejectOldWrite(Error('disconnected'));
await oldApply;assert.equal(handle.requiresReconnect(),false,'previous disconnected apply must not mark fresh connection uncertain');helper.getSetting=getSettingBefore;active=true;handle.destroy();handle=create();await handle.ready;
// Lost ACK resolves controller operation but keeps session write/Save guard locked.
writeMode='lost';timeoutMode=true;open('voltage1');await assert.rejects(dialog.apply('21'),{code:'batteryCalibrationUnconfirmed'});assert.ok(handle.busy());assert.ok(handle.requiresReconnect());
await assert.rejects(dialog.apply('21'),{code:'batteryCalibrationUnconfirmed'});
token++;writeMode='normal';timeoutMode=false;assert.equal(handle.busy(),false,'new connection clears pending session guard');
active=false;await assert.rejects(dialog.read(),{code:'batteryCalibrationCommunication'});handle.destroy();
globalThis.setTimeout=realTimeout;console.log('PASS production adapter: actual wire offsets/lengths, voltage2 additive offset formula, current1 inverse scale, point SET isolation, no EEPROM/reboot, malformed data, unsaved controls, cleanup');

});

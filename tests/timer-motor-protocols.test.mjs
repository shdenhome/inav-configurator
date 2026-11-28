import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseTimerProtocols,encodeTimerProtocols,effectiveTimerProtocol,summarizeTimerProtocols} from '../js/timerMotorProtocols.js';
const view = (...bytes) => new DataView(Uint8Array.from(bytes).buffer);

test('timer protocol API v1 preserves explicit STANDARD zero and inherited real protocol values', () => {
    assert.deepEqual(parseTimerProtocols(view(1,3,0,255,3,1,0,0,2,5,5)), [
        {timer:0,configured:255,effective:3},{timer:1,configured:0,effective:0},{timer:2,configured:5,effective:5}]);
    assert.deepEqual(parseTimerProtocols(view(1,2,0,0,0,1,113,0),true), [{timer:0,mask:0},{timer:1,mask:113}]);
    assert.deepEqual(parseTimerProtocols(view(1,0)),[]);
});

test('timer protocol API rejects unsupported/truncated/duplicate/sparse or malformed replies', () => {
    for (const bytes of [[],[1],[2,0],[1,1],[1,0,0],[1,1,0,255],[1,1,1,255,5],
        [1,2,0,255,5,0,255,5],[1,1,0,255,255]]) assert.equal(parseTimerProtocols(view(...bytes)),null,JSON.stringify(bytes));
    for(let configured=0; configured<256;configured++) {
        const result=parseTimerProtocols(view(1,1,0,configured,5));
        assert.equal(result!==null,[0,4,5,6,255].includes(configured),String(configured));
    }
    assert.equal(parseTimerProtocols(view(1,2,1,1,0,1,1,0),true),null);
});

test('timer protocol encoder uses v1 atomic pairs without mutating input', () => {
    const records=[{timer:0,configured:255,effective:5},{timer:4,configured:0,effective:0}];
    const snapshot=structuredClone(records);
    assert.deepEqual(encodeTimerProtocols(records),[1,2,0,255,4,0]);
    assert.deepEqual(records,snapshot);
    assert.deepEqual(encodeTimerProtocols([]),[1,0]);
});

test('timer protocol encoder rejects every unsupported override and malformed or duplicate timer', () => {
    for(let configured=0;configured<256;configured++) {
        const call=()=>encodeTimerProtocols([{timer:0,configured}]);
        if([0,4,5,6,255].includes(configured)) assert.doesNotThrow(call); else assert.throws(call);
    }
    for(const timer of [-1,255,256,0.5,'0',NaN,undefined]) assert.throws(()=>encodeTimerProtocols([{timer,configured:255}]));
    for(const configured of ['5',undefined,NaN,-1,256,0.5]) assert.throws(()=>encodeTimerProtocols([{timer:0,configured}]));
    assert.throws(()=>encodeTimerProtocols([{timer:0,configured:0},{timer:0,configured:5}]));
    assert.throws(()=>encodeTimerProtocols(Array.from({length:256},(_,timer)=>({timer,configured:255}))));
});

test('effective protocol follows the current RAM default while explicit STANDARD overrides remain zero', () => {
    assert.equal(effectiveTimerProtocol({configured:255,effective:5},'0'),0);
    assert.equal(effectiveTimerProtocol({configured:0,effective:0},5),0);
    assert.equal(effectiveTimerProtocol(undefined,5),5);
});

test('MIXED summary only uses motor groups, preserves dormant overrides and follows changed default', () => {
    const records=[{timer:4,configured:255},{timer:7,configured:0},{timer:2,configured:6}];
    const copy=structuredClone(records);
    assert.deepEqual(summarizeTimerProtocols(records,5,new Set([4,7])),{mixed:true,protocols:[5,0]});
    assert.deepEqual(summarizeTimerProtocols(records,0,new Set([4,7])),{mixed:false,protocols:[0]});
    assert.deepEqual(summarizeTimerProtocols(records,5,new Set([4])),{mixed:false,protocols:[5]});
    assert.deepEqual(summarizeTimerProtocols(records,5,new Set()),{mixed:false,protocols:[]});
    assert.deepEqual(records,copy);
});

// Execute the actual helper methods from MSPHelper without importing Electron.
// The transport stub emulates decoded responses before queue callbacks, exactly
// as MSP.processData does. No implementation of the save/load methods is mirrored.
const helperSource=fs.readFileSync(new URL('../js/msp/MSPHelper.js',import.meta.url),'utf8');
function createHarness() {
    const sent=[],logs=[];let continuation=0;
    const FC={TIMER_MOTOR_PROTOCOLS:[{timer:0,configured:255}],TIMER_PROTOCOL_CAPABILITIES:[{timer:0,mask:113}]};
    const MSPCodes={MSP2_INAV_TIMER_MOTOR_PROTOCOLS:0x20a5,MSP2_INAV_SET_TIMER_MOTOR_PROTOCOLS:0x20a6,MSP2_INAV_TIMER_PROTOCOL_CAPABILITIES:0x20a7};
    const ctx={FC,MSPCodes,encodeTimerProtocols,self:{},GUI:{log:m=>logs.push(m)},i18n:{getMessage:k=>k},MSP:{send_message:(code,payload,unused,callback)=>sent.push({code,payload,callback})}};
    vm.createContext(ctx);
    const start=helperSource.indexOf('    self.loadTimerMotorProtocols = function');
    const end=helperSource.indexOf('    self.loadTimerOutputModes = function',start);
    assert.ok(start>=0 && end>start);
    vm.runInContext(helperSource.slice(start,end),ctx);
    return {...ctx,sent,logs,next:()=>continuation++,continued:()=>continuation};
}

test('actual MSP loader clears old device state and skips capability request on unsupported old firmware', () => {
    const h=createHarness();h.self.loadTimerMotorProtocols(h.next);
    assert.equal(h.FC.TIMER_MOTOR_PROTOCOLS,null);assert.equal(h.FC.TIMER_PROTOCOL_CAPABILITIES,null);
    assert.equal(h.sent.length,1);assert.equal(h.sent[0].code,0x20a5);
    h.sent[0].callback();assert.equal(h.continued(),1);assert.equal(h.sent.length,1);
});

test('actual MSP loader requests capabilities after successful protocol read', () => {
    const h=createHarness();h.self.loadTimerMotorProtocols(h.next);
    h.FC.TIMER_MOTOR_PROTOCOLS=[{timer:0,configured:255,effective:5}];h.sent[0].callback();
    assert.equal(h.sent[1].code,0x20a7);h.sent[1].callback();assert.equal(h.continued(),1);
});

test('actual MSP setter advances save chain only for explicit versioned success', () => {
    for(const response of [false,undefined,{data:view()},{data:view(1)},{data:view(1,1)},{data:view(2,0)},{data:view(1,0,0)},{data:view(1,0)}]) {
        const h=createHarness();let failures=0;h.self.sendTimerMotorProtocols(h.next,()=>failures++);
        assert.deepEqual(Array.from(h.sent[0].payload),[1,1,0,255]);
        h.sent[0].callback(response);
        assert.equal(h.continued(),response?.data?.byteLength===2 && response.data.getUint8(0)===1 && response.data.getUint8(1)===0?1:0);
        assert.equal(failures,h.continued()?0:1,'failure releases Outputs save queue');
        assert.equal(h.sent.length,1,'setter itself must not write EEPROM or reboot');
    }
});

test('actual MSP setter is legacy no-op, but invalid local config halts before EEPROM chain', () => {
    const old=createHarness();old.FC.TIMER_PROTOCOL_CAPABILITIES=null;old.self.sendTimerMotorProtocols(old.next);
    assert.equal(old.sent.length,0);assert.equal(old.continued(),1);
    const invalid=createHarness();invalid.FC.TIMER_MOTOR_PROTOCOLS=[{timer:0,configured:7}];
    invalid.self.sendTimerMotorProtocols(invalid.next);assert.equal(invalid.sent.length,0);assert.equal(invalid.continued(),0);assert.equal(invalid.logs.length,1);
});

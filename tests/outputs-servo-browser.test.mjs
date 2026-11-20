import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'acorn';
import MSPCodes from '../js/msp/MSPCodes.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
function nodes(node, predicate, found = []) {
    if (!node || typeof node !== 'object') return found;
    if (predicate(node)) found.push(node);
    for (const [key, value] of Object.entries(node)) if (key !== 'start' && key !== 'end') {
        if (Array.isArray(value)) value.forEach(child => nodes(child, predicate, found));
        else if (value && typeof value === 'object') nodes(value, predicate, found);
    }
    return found;
}
function extract(source, predicate) {
    const found = nodes(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), predicate);
    assert.equal(found.length, 1, 'production component must have exactly one matching implementation');
    return source.slice(found[0].start, found[0].end);
}

// Exercise the actual process_servos component, HTML, controller, MSP serializer and
// save chain. Only unrelated tab sections, transport and hardware are substituted.
test('Outputs browser: wheel, centering, Live MSP batches, EEPROM save/reboot and reload', { skip: !chrome, timeout: 45000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'inav-output-servos-'));
    try {
        const source = readFileSync(join(root, 'tabs/outputs.js'), 'utf8');
        const component = extract(source, node => node.type === 'FunctionDeclaration' && node.id?.name === 'process_servos');
        const settings = extract(source, node => node.type === 'FunctionDeclaration' && node.id?.name === 'saveSettings');
        const chain = extract(source, node => node.type === 'ExpressionStatement' && node.expression?.callee?.object?.name === 'saveChainer' && node.expression?.callee?.property?.name === 'setChain');
        const helper = readFileSync(join(root, 'js/msp/MSPHelper.js'), 'utf8');
        const assignments = ['sendServoConfigurations', 'saveToEeprom', 'saveAdvancedConfig', 'saveMiscV2', 'save3dConfig'].map(name =>
            extract(helper, node => node.type === 'AssignmentExpression' && node.left?.object?.name === 'self' && node.left?.property?.name === name).replace(/^self\./, 'mspHelper.') + ';').join('\n');
        const controls = readFileSync(join(root, 'js/servoOutputControls.js'), 'utf8').replace(/^export /gm, '');
        const chainer = readFileSync(join(root, 'js/msp/MSPchainer.js'), 'utf8').replace('export default MSPChainerClass;', '');
        const timeouts = readFileSync(join(root, 'js/timeouts.js'), 'utf8').replace('export default timeout;', '');
        const bits = readFileSync(join(root, 'js/bitHelper.js'), 'utf8').replace('export default BitHelper;', '');
        const template = readFileSync(join(root, 'tabs/outputs.html'), 'utf8');
        const tableStart = template.indexOf('<div class="tab-servos"');
        const tableEnd = template.indexOf('\n        </div>\n    </div>\n    <div class="content_toolbar">', tableStart);
        const toolbarStart = template.indexOf('<div class="content_toolbar">', tableEnd);
        assert.ok(tableStart >= 0 && tableEnd > tableStart && toolbarStart > tableEnd);
        const body = '<div class="tab-motors"><div id="servoEmptyTableInfo"></div>' + template.slice(tableStart, tableEnd) + template.slice(toolbarStart, template.lastIndexOf('\n</div>')) + '</div>';
        const messages = Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(root, 'locale/ru/messages.json'), 'utf8'))).map(([key, value]) => [key, value.message]));
        const script = `
${controls}\n${chainer}\n${timeouts}\n${bits}
const MSPCodes=${JSON.stringify(MSPCodes)}, messages=${JSON.stringify(messages)};
const self={}, sent=[], checkpoints=[];let persisted=null, holdServoAck=false, held=null, rebootCount=0, settingsWrites=0;
const original=[{min:1000,middle:1540,max:2000,rate:100},{min:500,middle:600,max:2500,rate:-80}];
const FC={SERVO_CONFIG:structuredClone(original),SERVO_RULES:{getServoCount:()=>2,isServoConfigured:()=>true},MIN_SERVO_RATE:-125,MAX_SERVO_RATE:125,MIXER_CONFIG:{platformType:1},OUTPUT_MAPPING:{getMrServoOutput:i=>i+1,getFwServoOutput:i=>i+1},REVERSIBLE_MOTORS:{},MOTOR_RULES:{cleanup(){}}};
const PLATFORM={MULTIROTOR:0,TRICOPTER:2};
const i18n={getMessage:key=>messages[key]||key};
const GUI={log(){},tab_switch_cleanup(done){self.cleanupServoControls?.();done();},handleReconnect(){rebootCount++;}};
const Settings={saveInputs(done){settingsWrites++;done();}};
const features={reset(){},fromUI(){},execute(done){done();}};
const MSP={send_message(code,buffer,unused,done){sent.push({code,data:buffer===false?null:[...buffer]});if(code===MSPCodes.MSP_EEPROM_WRITE)persisted=structuredClone(FC.SERVO_CONFIG);if(code===MSPCodes.MSP2_INAV_SET_SERVO_CONFIG&&holdServoAck){held=done;return;}queueMicrotask(()=>done?.({data:new DataView(new ArrayBuffer(0))}));}};
const mspHelper={crunch:()=>[]};
${assignments}
const saveChainer=new MSPChainerClass();
${settings}\n${chain}\n${component}
const wait=()=>new Promise(resolve=>setTimeout(resolve,40));
const table=()=>document.querySelector('#servo-config-table');
const row=i=>table().querySelectorAll('tr:not(.main)')[i];
const input=(i,key)=>row(i).querySelector('td.'+key+' input');
const button=i=>row(i).querySelector('.servo-center-range');
const value=(i,key)=>Number(input(i,key).value);
const change=(i,key,v)=>{input(i,key).value=v;input(i,key).dispatchEvent(new Event('change',{bubbles:true}));};
const range=(i,min,middle,max)=>{input(i,'min').value=min;input(i,'middle').value=middle;input(i,'max').value=max;input(i,'middle').dispatchEvent(new Event('change',{bubbles:true}));};
const live=enabled=>{$('div.live input').prop('checked',enabled).trigger('change');};
function check(condition,label){if(!condition)throw new Error(label);checkpoints.push(label);}
function wheel(i,key,delta,shift=false){const e=new WheelEvent('wheel',{deltaY:delta,shiftKey:shift,bubbles:true,cancelable:true});input(i,key).dispatchEvent(e);check(e.defaultPrevented,'wheel prevents browser default');}
function servoFrames(){return sent.filter(frame=>frame.code===MSPCodes.MSP2_INAV_SET_SERVO_CONFIG);}
function eepromFrames(){return sent.filter(frame=>frame.code===MSPCodes.MSP_EEPROM_WRITE);}
const u16=(data,offset)=>data[offset]|data[offset+1]<<8;
(async()=>{try{
 process_servos();
 check(row(0).children.length===8&&row(0).children[4].contains(button(0)),'centering button is between Max and Rate');
 check(button(0).classList.contains('is-asymmetric'),'off-center initial Mid highlights button');
 button(0).click();check(value(0,'min')===1040&&value(0,'middle')===1540&&value(0,'max')===2040,'centering matches 1040/1540/2040 example');
 check(!button(0).classList.contains('is-asymmetric'),'centering clears asymmetric highlight');
 check(value(1,'middle')===600&&value(1,'max')===2500,'centering one row leaves the other unchanged');
 for(const key of ['min','middle','max'])for(const shift of [false,true])for(const delta of [-120,120]){range(0,1000,1500,2000);const before=value(0,key);wheel(0,key,delta,shift);check(value(0,key)===before+(delta<0?1:-1)*(shift?10:1),'wheel '+key+' '+shift+' '+delta);}
 range(0,1000,1500,2000);const horizontalShift=new WheelEvent('wheel',{deltaX:120,deltaY:0,shiftKey:true,bubbles:true,cancelable:true});input(0,'middle').dispatchEvent(horizontalShift);check(value(0,'middle')===1490&&horizontalShift.defaultPrevented,'Shift wheel remapped to horizontal delta steps by 10');
 range(0,500,1500,2500);wheel(0,'min',120,true);wheel(0,'max',-120,true);check(value(0,'min')===500&&value(0,'max')===2500,'wheel respects firmware limits');
 range(0,1499,1500,1501);wheel(0,'min',-120,true);wheel(0,'max',120,true);check(value(0,'min')===1500&&value(0,'max')===1500,'wheel cannot cross Mid');wheel(0,'middle',-120,true);check(value(0,'middle')===1500,'Mid wheel stays within endpoints');
 range(0,1000,1500,2000);change(0,'min',1900);check(value(0,'min')===1500,'manual Min cannot cross Mid');change(0,'max',700);check(value(0,'max')===1500,'manual Max cannot cross Mid');
 range(0,1000,1500,2000);change(0,'middle',2501);check(value(0,'middle')===2000,'manual Mid clamps to Max');change(0,'middle','');check(value(0,'middle')===2000,'empty Mid reverts to valid value');
 range(0,1000,1500,2000);input(0,'middle').value=1540;input(0,'middle').dispatchEvent(new Event('input',{bubbles:true}));check(button(0).classList.contains('is-asymmetric'),'typing updates highlight before commit');input(0,'middle').value='';input(0,'middle').dispatchEvent(new Event('input',{bubbles:true}));check(button(0).disabled,'incomplete input cannot center an invalid range');change(0,'middle',1500);
 button(1).click();check(value(1,'min')===500&&value(1,'max')===700,'second row symmetry shrinks span at lower firmware limit');
 await wait();check(sent.length===0,'Live off produces no MSP or EEPROM writes');check(FC.SERVO_CONFIG[0].middle===1540,'Live off retains changes in UI');
 live(true);range(0,1000,1500,2000);await wait();sent.length=0;
 wheel(0,'middle',-120);await wait();check(servoFrames().length===2&&eepromFrames().length===0,'one live wheel action sends one servo batch and no EEPROM');check(u16(servoFrames()[0].data,5)===1501,'actual MSP serializer sends changed Mid');
 change(0,'middle',1540);await wait();sent.length=0;button(0).click();await wait();
 check(servoFrames().length===2&&eepromFrames().length===0,'centering sends only one live batch');const packet=servoFrames()[0].data;check(u16(packet,1)===1040&&u16(packet,3)===2040&&u16(packet,5)===1540,'one MSP packet contains both centered endpoints');
 sent.length=0;wheel(0,'middle',-120);wheel(0,'middle',-120);await wait();check(servoFrames().length===2&&u16(servoFrames()[0].data,5)===1542,'rapid wheel steps coalesce and preserve latest value');
 sent.length=0;holdServoAck=true;wheel(0,'middle',-120);await wait();check(servoFrames().length===1,'live batch waits for first servo acknowledgement');
 change(0,'middle',1550);$('a.update').trigger('click');await wait();check(eepromFrames().length===0,'Save waits for in-flight live batch');holdServoAck=false;held();await wait();
 check(eepromFrames().length===1&&settingsWrites===1,'Save writes EEPROM exactly once through normal settings chain');check(persisted[0].middle===1550,'Save captures latest UI values');
 const codes=sent.map(f=>f.code);check(codes.at(-1)===MSPCodes.MSP_EEPROM_WRITE&&codes.includes(MSPCodes.MSP_SET_ADVANCED_CONFIG)&&codes.includes(MSPCodes.MSPV2_INAV_SET_MISC)&&codes.includes(MSPCodes.MSP_SET_3D),'full save sequence retains motor/3D settings before EEPROM');
 const saved=structuredClone(persisted);self.cleanupServoControls();$('.tab-motors').remove();$('body').append(${JSON.stringify(body)});FC.SERVO_CONFIG=structuredClone(saved);process_servos();
 check(value(0,'min')===saved[0].min&&value(0,'middle')===saved[0].middle&&value(0,'max')===saved[0].max,'reloading saved data restores Min/Mid/Max');check($('.rate-input').eq(1).val()==='80'&&$('.reverse-input').eq(1).prop('checked'),'rate and reverse survive save/reload');
 sent.length=0;change(0,'middle',1560);$('a.save').trigger('click');await wait();check(eepromFrames().length===1&&sent.filter(f=>f.code===MSPCodes.MSP_SET_REBOOT).length===1&&rebootCount===1,'Save and Reboot persists once then reboots');
 $('.tab-motors').remove();$('body').append(${JSON.stringify(body)});process_servos();live(true);sent.length=0;wheel(0,'middle',-120);self.cleanupServoControls();await wait();check(sent.length===0,'tab cleanup cancels pending live writes');
 if(${JSON.stringify(Boolean(process.env.INAV_OUTPUTS_UI_PREVIEW))}){
  $('.tab-motors').remove();$('body').append(${JSON.stringify(body)});FC.SERVO_CONFIG=structuredClone(original);FC.SERVO_CONFIG[1]={min:1000,middle:1500,max:2000,rate:-80};process_servos();
  document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=messages[el.dataset.i18n]||el.dataset.i18n;});
 }
 document.body.dataset.servoResult=btoa(unescape(encodeURIComponent(JSON.stringify({ok:true,checkpoints}))));
}catch(error){document.body.dataset.servoResult=btoa(unescape(encodeURIComponent(JSON.stringify({ok:false,error:error.stack,checkpoints}))));}})();`;
        const styles = ['src/css/main.css', 'src/css/tabs/motors.css'].map(path => '<link rel="stylesheet" href="' + pathToFileURL(join(root, path)).href + '">').join('');
        const html = '<!doctype html><html><meta charset="utf-8">' + styles + '<style>body{margin:0;padding:1em;background:white}body>input{display:none}.content_toolbar{position:static!important;margin-top:1em}</style><body>' + body + '<input id="3ddeadbandlow" value="1406"><input id="3ddeadbandhigh" value="1514"><input id="3dneutral" value="1460"><script src="' + pathToFileURL(join(root, 'node_modules/jquery/dist/jquery.min.js')).href + '"></script><script>' + script + '</script></body></html>';
        const path = join(dir, 'test.html'); writeFileSync(path, html);
        const previewArgs = process.env.INAV_OUTPUTS_UI_PREVIEW ? ['--screenshot=' + process.env.INAV_OUTPUTS_UI_PREVIEW, '--window-size=' + (process.env.INAV_OUTPUTS_UI_SIZE || '1024,480'), '--force-device-scale-factor=1', '--hide-scrollbars'] : [];
        const result = spawnSync(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(dir, 'profile'), '--virtual-time-budget=10000', '--dump-dom', ...previewArgs, pathToFileURL(path).href], { encoding: 'utf8', timeout: 35000, maxBuffer: 4 * 1024 * 1024 });
        assert.equal(result.status, 0, result.stderr);
        const match = result.stdout.match(/data-servo-result="([^"]+)"/);
        assert.ok(match, 'browser test did not complete: ' + result.stderr + result.stdout.slice(-1800));
        const report = JSON.parse(Buffer.from(match[1], 'base64').toString());
        assert.equal(report.ok, true, report.error);
        assert.ok(report.checkpoints.length >= 45);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

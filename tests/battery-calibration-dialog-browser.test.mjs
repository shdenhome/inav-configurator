import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const chrome = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
test(
    'battery calibration dialog serializes reads/apply, reports actual results/errors and cancels late replies',
    { skip: !chrome, timeout: 30000 },
    () => {
        const dir = mkdtempSync(join(tmpdir(), 'inav-battery-dialog-'));
        try {
            const source = readFileSync(join(root, 'js/batteryCalibrationDialog.js'), 'utf8').replace(
                'export function',
                'function'
            );
            const script = `${source}
 const timers=new Map();let timerId=0;window.setInterval=f=>{timers.set(++timerId,f);return timerId;};window.clearInterval=id=>timers.delete(id);
 const check=(ok,label)=>{if(!ok)throw Error(label);};const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
 const i18n={getMessage:key=>key};let box;class Modal{constructor(type,options){this.options=options;box=this;}open(){this.options.content.appendTo('body');return this;}close(){this.options.onClose();return this;}destroy(){this.options.content.remove();}}
 (async()=>{try{
 let reads=0,applies=0,closed=0;const first=deferred(),write=deferred();let sent;
 const handle=openBatteryCalibrationDialog({$,jBox:Modal,i18n,title:'Battery2 voltage',unit:'V',read:()=>{reads++;return reads===1?first.promise:Promise.resolve({value:19.7,scale:1200});},apply:reference=>{applies++;sent=reference;return write.promise;},onClose:()=>closed++});await flush();
 check(reads===1,'read on open');for(const f of timers.values())f();await flush();check(reads===1,'no overlapping reads');
 const content=box.options.content;content.find('input').val('20,1');content.find('.modal__button--main').trigger('click');content.find('.modal__button--main').trigger('click');await flush();check(applies===0,'apply waits pending read');check(timers.size===0,'timer paused for apply');
 first.resolve({value:19.2,scale:1100});await flush();check(applies===1&&sent==='20,1','one apply, raw reference passed');check(content.find('input').prop('disabled'),'reference locked during apply');
 write.resolve({value:19.6,scale:1200});await flush();check(content.find('dd').eq(0).text()==='19.60 V','actual post-write reading shown, not predicted reference');check(content.find('dd').eq(1).text()==='1200','actual scale shown');check(content.find('[role=status]').text()==='batteryCalibrationSuccess','success state');check(timers.size===1,'periodic read resumed');
 handle.close();handle.close();check(closed===1&&timers.size===0,'close cleanup once');
 const late=deferred();let active=true;const h2=openBatteryCalibrationDialog({$,jBox:Modal,i18n,title:'Battery1 current',unit:'A',read:()=>late.promise,apply:()=>{throw Error('must not apply');},isActive:()=>active});await flush();const old=box.options.content;h2.close();late.resolve({value:8,scale:200});await flush();check(old.find('dd').eq(0).text()==='—','closed view ignores late read');
 const h3=openBatteryCalibrationDialog({$,jBox:Modal,i18n,title:'Current',unit:'A',read:()=>Promise.resolve({value:3,scale:100}),apply:()=>Promise.reject({code:'batteryCalibrationRange'})});await flush();box.options.content.find('input').val('3.5');box.options.content.find('.modal__button--main').trigger('click');await flush();check(box.options.content.find('[role=status]').text()==='batteryCalibrationRange','controller error localized');check(!box.options.content.find('input').prop('disabled'),'error unlocks retry');for(const tick of timers.values())tick();await flush();check(box.options.content.find('[role=status]').text()==='batteryCalibrationRange','valid live read preserves apply validation error');box.options.content.find('input').val('3.6').trigger('input');check(box.options.content.find('[role=status]').text()==='','editing reference clears validation error');h3.close();
 const h4=openBatteryCalibrationDialog({$,jBox:Modal,i18n,title:'Voltage',unit:'V',read:()=>Promise.reject({code:'batteryCalibrationNoSample'}),apply:()=>Promise.resolve({value:1,scale:2,unchanged:true})});await flush();check(box.options.content.find('[role=status]').text()==='batteryCalibrationNoSample','read error displayed');box.options.content.find('input').val('1');box.options.content.find('.modal__button--main').trigger('click');await flush();check(box.options.content.find('[role=status]').text()==='batteryCalibrationUnchanged','unchanged result');h4.close();
 let pendingReads=0;const h5=openBatteryCalibrationDialog({$,jBox:Modal,i18n,title:'Pending',unit:'V',read:()=>{pendingReads++;return pendingReads===1?Promise.resolve({value:19,scale:1000}):pendingReads===2?Promise.reject({code:'batteryCalibrationNoSample'}):Promise.resolve({value:19.85,scale:1045});},apply:()=>Promise.resolve({value:null,scale:1045,pending:true})});await flush();const pendingContent=box.options.content;pendingContent.find('input').val('20');pendingContent.find('.modal__button--main').trigger('click');await flush();check(pendingContent.find('dd').eq(0).text()==='—','pending never displays predicted reading');check(pendingContent.find('dd').eq(1).text()==='1045','confirmed pending scale displayed');check(pendingContent.find('[role=status]').text()==='batteryCalibrationAppliedNoSample','pending is not success');for(const tick of timers.values())tick();await flush();check(pendingContent.find('dd').eq(1).text()==='1045','pending read failure preserves confirmed scale');check(pendingContent.find('[role=status]').text()==='batteryCalibrationAppliedNoSample','pending read failure remains waiting');for(const tick of timers.values())tick();await flush();check(pendingContent.find('dd').eq(0).text()==='19.85 V','later actual reading displayed');check(pendingContent.find('[role=status]').text()==='batteryCalibrationSuccess','success only after actual reading');h5.close();
 let unknownApplies=0;const h6=openBatteryCalibrationDialog({$,jBox:Modal,i18n,title:'Unknown write',unit:'A',read:()=>Promise.resolve({value:1,scale:10}),apply:()=>{unknownApplies++;return Promise.reject({code:'batteryCalibrationUnconfirmed'});}});await flush();box.options.content.find('input').val('2');box.options.content.find('.modal__button--main').trigger('click');await flush();check(box.options.content.find('[role=status]').text()==='batteryCalibrationUnconfirmed','unknown write result has explicit error');check(box.options.content.find('.modal__button--main').prop('disabled'),'unknown write blocks recalculation');for(const tick of timers.values())tick();await flush();check(box.options.content.find('[role=status]').text()==='batteryCalibrationUnconfirmed','successful reads preserve unknown write warning');box.options.content.find('input').val('3').trigger('input');check(box.options.content.find('[role=status]').text()==='batteryCalibrationUnconfirmed','editing cannot clear fatal error');box.options.content.find('.modal__button--main').trigger('click');box.options.content.find('input').trigger($.Event('keydown',{key:'Enter'}));await flush();check(unknownApplies===1,'unknown write cannot be retried');h6.close();
 check(timers.size===0,'all timers cleaned');document.body.dataset.result='PASS';
 }catch(e){document.body.dataset.result='FAIL '+e.message;}})();`;
            const path = join(dir, 'test.html');
            writeFileSync(
                path,
                '<!doctype html><body><script src="' +
                    pathToFileURL(join(root, 'node_modules/jquery/dist/jquery.min.js')).href +
                    '"></script><script>' +
                    script +
                    '</script>'
            );
            const r = spawnSync(
                chrome,
                [
                    '--headless',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--user-data-dir=' + join(dir, 'profile'),
                    '--virtual-time-budget=3000',
                    '--dump-dom',
                    pathToFileURL(path).href,
                ],
                { encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024 }
            );
            assert.equal(r.status, 0, r.stderr);
            assert.match(r.stdout, /data-result="PASS"/, r.stdout.slice(-1200));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
);

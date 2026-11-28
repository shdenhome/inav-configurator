import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parse} from 'acorn';
const root=fileURLToPath(new URL('..',import.meta.url));
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
function extractFunction(file,name) {
    const source=fs.readFileSync(join(root,file),'utf8');let found=[];
    function visit(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id?.name===name)found.push(n);for(const[k,v]of Object.entries(n))if(k!=='start'&&k!=='end'){if(Array.isArray(v))v.forEach(visit);else visit(v)}}
    visit(parse(source,{ecmaVersion:'latest',sourceType:'module'}));assert.equal(found.length,1,name);
    return source.slice(found[0].start,found[0].end);
}

test('actual timer selectors and Motors summary: mapping, independence, reset, old firmware and widths', {skip:!fs.existsSync(chrome),timeout:60000},()=>{
    const dir=fs.mkdtempSync(join(tmpdir(),'inav-timer-ui-'));
    try {
        const fileUrl=p=>pathToFileURL(join(root,p)).href;
        const module=fs.readFileSync(join(root,'js/timerMotorProtocols.js'),'utf8').replace(/^export /gm,'');
        const funcs=['buildTimerGroups','buildTimerSelectHtml','renderOutputTable','renderTimerProtocols','renderMixerTimerColors'].map(n=>extractFunction('tabs/mixer.js',n)).join('\n')+'\n'+extractFunction('tabs/outputs.js','renderTimerProtocolSummary');
        const mixerHtml=fs.readFileSync(join(root,'tabs/mixer.html'),'utf8');
        const outputsHtml=fs.readFileSync(join(root,'tabs/outputs.html'),'utf8');
        const locale=fs.readFileSync(join(root,'locale/ru/messages.json'),'utf8');
        const script=`${module}\n${funcs}
        const translations=${locale};const i18n={getMessage:k=>translations[k]?.message||k};
        const timers=[2,2,4,4,4,4,3,3,3,3,11,11,0,1,7];
        const map=['Servo 1','Servo 2','Motor 1','Motor 2','Motor 3','Motor 4','Servo 3','Servo 4','Servo 5','Servo 6','Servo 7','Servo 8','LED','Beeper','Motor 5'];
        const modes={4:1,7:1};
        const FC={ADVANCED_CONFIG:{motorPwmProtocol:5},MIXER_CONFIG:{platformType:0},TIMER_MOTOR_PROTOCOLS:Array.from({length:17},(_,timer)=>({timer,configured:timer===7?0:255,effective:timer===7?0:5})),TIMER_PROTOCOL_CAPABILITIES:Array.from({length:17},(_,timer)=>({timer,mask:[4,7].includes(timer)?113:1})),OUTPUT_MAPPING:{getOutputCount:()=>timers.length,getTimerId:i=>timers[i],getOutputTimerColor:i=>({2:'#e9c46a',4:'#e76f51',3:'#f4a261',11:'#ffc300',0:'#8ecae6',1:'#2a9d8f',7:'#ef476f'}[timers[i]]),getUsedTimerIds:()=>[...new Set(timers)].map(String),getTimerOverride:t=>modes[t]||0,isTimerDefaultLed:t=>t===0,isTimerDefaultBeeper:t=>t===1,isLedPin:i=>i===12,isBeeperPin:i=>i===13,hasDirectAssignment:()=>true,getOutputTableDirect:()=>map,TIMER_OUTPUT_MODE_AUTO:0,TIMER_OUTPUT_MODE_MOTORS:1}};
        const PLATFORM={MULTIROTOR:0,TRICOPTER:3};const results=[];
        function check(ok,label){results.push({ok,label});if(!ok)throw Error(label)}
        try {
            renderOutputTable();const baseline=document.querySelector('.output-table').getBoundingClientRect();renderTimerProtocols(map);
            check(document.querySelectorAll('.timer-motor-protocol').length===2,'selectors only for motor groups');
            const selectors=[...document.querySelectorAll('.timer-motor-protocol')];
            check(selectors[0].value==='255'&&selectors[1].value==='0','DEFAULT and explicit STANDARD preserved');
            check([...selectors[0].options].map(o=>o.value).join(',')==='255,0,4,5,6','capabilities restrict options');
            const table=document.querySelector('.output-table').getBoundingClientRect();
            check(selectors.every(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1}),'selectors contained in timer columns');
            check(table.right<=Math.max(innerWidth,baseline.right)+1,'table fits supported window width '+JSON.stringify({right:table.right,width:table.width,window:innerWidth,baselineRight:baseline.right}));
            $(selectors[0]).val('4').trigger('change');
            check(FC.TIMER_MOTOR_PROTOCOLS[4].configured===4&&FC.TIMER_MOTOR_PROTOCOLS[7].configured===0,'one selection changes only its timer');
            renderTimerProtocols(map);check(document.querySelectorAll('#timer-protocol-row').length===1,'redraw idempotent');
            check([...document.querySelectorAll('#timer-protocol-row td')].every((cell,i)=>getComputedStyle(cell).backgroundColor===getComputedStyle(document.querySelectorAll('#timer-row td')[i]).backgroundColor),'protocol cells match timer colours');
            modes[3]=1;renderTimerProtocols([]);check(document.querySelectorAll('.timer-motor-protocol').length===3,'MOTORS role offers protocol without motor rules');
            modes[4]=0;renderTimerProtocols(map);check(document.querySelectorAll('.timer-motor-protocol').length===2,'AUTO hides selector despite assigned motors');
            check(FC.TIMER_MOTOR_PROTOCOLS[4].configured===4,'hiding AUTO selector retains stored protocol');
            modes[4]=1;modes[3]=0;renderTimerProtocols(map);
            renderTimerProtocolSummary();check($('#timer-protocol-mode').text()==='MIXED','Motors summary derived MIXED');
            check($('#esc-protocols').css('display')==='none','MIXED hides global protocol field');
            check($('#timer-protocol-summary p').length===1&&$('#timer-protocol-summary').css('display')!=='none','MIXED retains explanatory hint');
            check($('#timer-motor-protocol-list li').length===5,'five motor mappings listed');
            check($('#timer-motor-protocol-list li').last().text().includes('S15')&&$('#timer-motor-protocol-list li').last().text().includes('STANDARD'),'physical output15 and analog protocol correct');
            $('#motor-mix-table tbody').html([1,5,99].map(n=>'<tr><td><span class="mix-rule-motor">'+n+'</span></td><td><input value="1"></td></tr>').join(''));
            $('#servo-mix-table tbody').html([1,1,3].map(n=>'<tr><td><input class="mix-rule-servo" value="'+n+'"></td><td>rule</td></tr>').join(''));
            renderMixerTimerColors(map);
            const motorRows=$('#motor-mix-table tbody tr'),servoRows=$('#servo-mix-table tbody tr');
            check(motorRows.eq(0).hasClass('timer-mapped-rule')&&motorRows[0].style.getPropertyValue('--mixer-timer-color')==='#e76f51','Motor 1 uses physical timer colour');
            check(motorRows[1].style.getPropertyValue('--mixer-timer-color')==='#ef476f','Motor 5 uses its own physical timer colour');
            check(!motorRows.eq(2).hasClass('timer-mapped-rule'),'unmapped motor retains neutral style');
            check(servoRows[0].style.getPropertyValue('--mixer-timer-color')==='#e9c46a'&&servoRows[1].style.getPropertyValue('--mixer-timer-color')==='#e9c46a','all rules for the same servo share timer colour');
            check(servoRows[2].style.getPropertyValue('--mixer-timer-color')==='#f4a261','servo target selects correct timer');
            check(getComputedStyle(motorRows[0].children[0]).backgroundColor===getComputedStyle(document.querySelectorAll('#output-row td')[2]).backgroundColor,'row cell background overrides alternating stripe');
            const moved=[...map];moved[2]='-';moved[14]='Motor 1';renderMixerTimerColors(moved);
            check(motorRows[0].style.getPropertyValue('--mixer-timer-color')==='#ef476f'&&!motorRows.eq(1).hasClass('timer-mapped-rule'),'reassignment updates colours and clears old binding');
            renderMixerTimerColors([]);check(!servoRows.eq(0).hasClass('timer-mapped-rule')&&servoRows[0].style.getPropertyValue('--mixer-timer-color')==='','unassigned rules clear stale colour');
            check(getComputedStyle(document.querySelector('.timer-motor-protocol')).textAlignLast==='center','protocol selection text centred');
            check(getComputedStyle(document.querySelector('#timer-output-4')).textAlignLast==='center','timer role selection text centred');
            $('#timer-protocol-reset').trigger('click');check(FC.TIMER_MOTOR_PROTOCOLS.every(r=>r.configured===255),'reset all groups to DEFAULT');
            check($('#timer-protocol-summary').css('display')==='none','uniform inherited summary hidden');
            check($('#esc-protocols').css('display')!=='none','uniform protocols restore global selector');
            map.fill('-');FC.TIMER_MOTOR_PROTOCOLS[7].configured=0;renderTimerProtocolSummary();
            check($('#timer-protocol-mode').text()==='MIXED'&&$('#esc-protocols').css('display')==='none','explicit MOTORS groups determine MIXED even without motor rules');
            FC.TIMER_MOTOR_PROTOCOLS=null;FC.TIMER_PROTOCOL_CAPABILITIES=null;renderTimerProtocols(map);
            check(document.querySelectorAll('#timer-protocol-row').length===0,'unsupported firmware hides new row');
            document.body.dataset.result='PASS';
        }catch(error){document.body.dataset.result='FAIL';results.push({error:String(error)})}
        document.querySelector('#result').textContent=JSON.stringify(results);`;
        fs.writeFileSync(join(dir,'test.html'),`<!doctype html><link rel="stylesheet" href="${fileUrl('src/css/main.css')}"><link rel="stylesheet" href="${fileUrl('src/css/tabs/mixer.css')}"><link rel="stylesheet" href="${fileUrl('src/css/tabs/motors.css')}"><style>body{margin:0}#content{margin-left:210px}.tab-mixer{padding:10px}</style><body><div id="content">${mixerHtml}${outputsHtml}</div><pre id="result"></pre><script src="${fileUrl('node_modules/jquery/dist/jquery.min.js')}"></script><script>${script}</script>`);
        for(const width of[1920,1280,1024]){
            const r=spawnSync(chrome,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+join(dir,'chrome-'+width),'--window-size='+width+',1100','--virtual-time-budget=500','--dump-dom',pathToFileURL(join(dir,'test.html')).href],{encoding:'utf8',timeout:20000,maxBuffer:4000000});
            assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/data-result="PASS"/,r.stdout.slice(-3000));
        }
    }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

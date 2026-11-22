import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'acorn';
const root = fileURLToPath(new URL('..', import.meta.url));
const chrome = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
function find(node, name) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) return node;
    for (const v of Object.values(node)) {
        if (Array.isArray(v)) {
            for (const child of v) {
                const found = find(child, name);
                if (found) return found;
            }
        } else if (v && typeof v === 'object') {
            const found = find(v, name);
            if (found) return found;
        }
    }
    return null;
}
test(
    'real MAG cards distinguish all sources, zero-trust fallback, calibration, orientation and missing data',
    { skip: !chrome, timeout: 30000 },
    () => {
        const dir = mkdtempSync(join(tmpdir(), 'inav-mag-cards-'));
        try {
            const source = readFileSync(join(root, 'tabs/sensors.js'), 'utf8');
            const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
            const funcs = ['updateMultiGraphs', 'plot_mag']
                .map((name) => {
                    const node = find(ast, name);
                    assert.ok(node);
                    return source.slice(node.start, node.end);
                })
                .join('\n');
            const telemetry = readFileSync(join(root, 'js/multiMagTelemetry.js'), 'utf8')
                .replace(/^import .*;\n/m, '')
                .replace(/^export /gm, '');
            const messages = Object.fromEntries(
                Object.entries(JSON.parse(readFileSync(join(root, 'locale/ru/messages.json'), 'utf8'))).map(
                    ([k, v]) => [k, v.message]
                )
            );
            const preview = process.env.INAV_MAG_UI_PREVIEW;
            const graphSupport = preview ? 'const margin={top:20,right:10,bottom:10,left:40};' + ['initDataArray','addSampleToData','updateGraphHelperSize','initGraphHelpers','drawGraph'].map(name=>{const n=find(ast,name);assert.ok(n);return source.slice(n.start,n.end);}).join('\n') : 'const initGraphHelpers=()=>({heightScale:{domain(){}}});const updateGraphHelperSize=()=>{};const initDataArray=()=>[];const addSampleToData=(d,n,v)=>n+1;const drawGraph=()=>{};';
            const script = `${telemetry}\nconst multiGraphs=new Map();const i18n={getMessage:key=>(${JSON.stringify(messages)})[key]||key};${graphSupport}${funcs}
try{const check=(ok,label)=>{if(!ok)throw new Error(label);};const source={uid:100,slot:0,hardware:11,bus:1,address:30,flags:431,confidence:900,calStatus:2,orientationConfidence:90,angles:[0,0,900],raw:[-1,2,-3],calibrated:[1024,-512,256],receivedAt:Date.now()};const snapshot={receivedAt:Date.now(),sources:[source,{...source,uid:200,slot:3,bus:2,flags:367,confidence:0},{...source,uid:300,slot:8,address:28,flags:1,confidence:0,calStatus:4}]};updateMultiGraphs(snapshot,['mag']);const cards=$('.multi-sensor-card.mag');check(cards.length===3,'all three individual cards');check(cards.eq(1).find('.title').text().includes('MAG 4'),'stable physical numbering');check(cards.eq(0).find('dd').eq(0).text()==='1.00','normalized X');check(cards.eq(1).find('dd').eq(3).text()==='0.00','zero confidence retained');check(cards.eq(1).find('dd').eq(5).text().includes('РЕЗЕРВ'),'fallback is explicit');check(cards.eq(2).find('dd').eq(4).text().includes('Нет'),'missing data state');check(cards.eq(0).find('dd').eq(7).text().includes('90.0'),'individual auto orientation');check(cards.eq(0).find('dd').eq(8).text()==='-1 / 2 / -3','raw axes separate');plot_mag(false);check(cards.toArray().every(el=>$(el).css('display')==='none'),'one checkbox hides all');plot_mag(true);check(cards.toArray().every(el=>$(el).css('display')!=='none'),'one checkbox shows all');updateMultiGraphs(null,['mag']);check($('.multi-sensor-card.mag').length===3,'transport failure retains source cards');if(${JSON.stringify(Boolean(process.env.INAV_MAG_UI_PREVIEW))}){for(let i=0;i<80;i++){snapshot.receivedAt=Date.now();snapshot.sources.forEach((s,j)=>{s.receivedAt=Date.now();s.calibrated=[Math.round(800+200*Math.sin(i/8+j)),Math.round(200*Math.cos(i/10+j)),200];});updateMultiGraphs(snapshot,['mag']);}}document.body.dataset.result='PASS';}catch(e){document.body.dataset.result='FAIL '+e.message;}`;
            const html =
                '<html><head>' + ['src/css/main.css','src/css/tabs/sensors.css'].map(p=>'<link rel="stylesheet" href="'+pathToFileURL(join(root,p)).href+'">').join('') + '<style>body{margin:0;padding:1em;background:white}</style></head><body><div class="tab-sensors"><input name="mag_on" type="checkbox" checked><select name="mag_scale"><option selected>2</option></select><div class="wrapper mag"></div></div><script src="' +
                pathToFileURL(join(root, 'node_modules/jquery/dist/jquery.min.js')).href +
                '"></script><script src="' + pathToFileURL(join(root,'node_modules/d3/dist/d3.min.js')).href + '"></script><script>' +
                script +
                '</script></body></html>';
            const path = join(dir, 'test.html');
            writeFileSync(path, html);
            const result = spawnSync(
                chrome,
                [
                    '--headless',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--user-data-dir=' + join(dir, 'profile'),
                    '--dump-dom',
                    ...(preview ? ['--screenshot='+preview,'--window-size=1100,1050','--hide-scrollbars'] : []),
                    pathToFileURL(path).href,
                ],
                { encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024 }
            );
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /data-result="PASS"/, result.stdout.slice(-1200));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
);


test('configuration lists additional MAG devices independently of calibration and preserves identical models',
    { skip: !chrome, timeout: 30000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'inav-config-mag-'));
    try {
        const source = readFileSync(join(root, 'tabs/configuration.js'), 'utf8');
        const node = find(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), 'updateMultiMagFields');
        assert.ok(node);
        const label = JSON.parse(readFileSync(join(root, 'locale/ru/messages.json'), 'utf8')).sensorMagnetometerNumber.message;
        const script = `let configurationMagInventory;const i18n={getMessage:(key,args)=>${JSON.stringify(label)}.replace('$1',args[0])};${source.slice(node.start,node.end)}
try {
const check=(ok,label)=>{if(!ok)throw Error(label);};
const names=[];names[7]='QMC5883';names[11]='LIS3MDL';$('#sensor-mag').data('setting-info',{table:{values:names}});
const a={uid:0x010d07,hardware:7,bus:1,address:13},b={uid:0x011e0b,hardware:11,bus:1,address:30};
configurationMagInventory={sources:[a,b],referenceUid:0};updateMultiMagFields();
check($('#multi-mag-fields input').length===1,'one additional uncalibrated device');
check($('#multi-mag-2').val()==='QMC5883','LIS primary leaves QMC');check($('#multi-mag-2').prop('readOnly'),'read-only');
const left=$('#sensor-mag').next('label')[0].getBoundingClientRect().left;
for(const label of document.querySelectorAll('.sensors .select label, .sensors .number label'))check(Math.abs(label.getBoundingClientRect().left-left)<0.5,'aligned sensor labels');
const extraStyle=getComputedStyle($('#multi-mag-2').parent()[0]),normalStyle=getComputedStyle($('#sensor-mag').parent()[0]);
for(const key of ['marginBottom','paddingBottom','borderBottomWidth'])check(extraStyle[key]===normalStyle[key],'matching sensor row '+key);
check($('#multi-mag-2').attr('title')==='I2C1 / 0x0D','endpoint');check($('#multi-mag-fields label').text()==='Магнитометр 2','localized number');
$('#sensor-mag').val('7');updateMultiMagFields();check($('#multi-mag-2').val()==='LIS3MDL','selected QMC leaves LIS');
configurationMagInventory.sources.push({...b,uid:0x021e0b,bus:2});$('#sensor-mag').val('11');updateMultiMagFields();
check($('#multi-mag-fields input').length===2,'same model on second bus retained');check($('#multi-mag-3').val()==='LIS3MDL','duplicate preserved');
$('#multi-mag-enabled').prop('checked',false);updateMultiMagFields();check($('#multi-mag-fields input').length===0,'disabled clears rows');
$('#multi-mag-enabled').prop('checked',true);configurationMagInventory=null;updateMultiMagFields();check($('#multi-mag-fields input').length===0,'no invented inventory');
configurationMagInventory={sources:[a,b]};updateMultiMagFields();document.body.dataset.result='PASS';
}catch(e){document.body.dataset.result='FAIL '+e.message;}`;
        const html = '<html><head><link rel="stylesheet" href="'+pathToFileURL(join(root,'src/css/main.css')).href+'"><link rel="stylesheet" href="'+pathToFileURL(join(root,'src/css/tabs/configuration.css')).href+'"></head><body><div class="tab-configuration"><div class="config-section sensors"><h3>Сенсоры и шины</h3><input id="multi-mag-enabled" type="checkbox" checked><div class="select"><select id="sensor-mag"><option value="7">QMC5883</option><option value="11" selected>LIS3MDL</option></select><label>Магнитометр</label></div><div id="multi-mag-fields"></div><div class="select"><select id="sensor-baro"><option>MS5611</option></select><label>Барометр</label></div><div class="number"><input readonly value="SPL06"><label>Барометр 2</label></div></div></div><script src="'+pathToFileURL(join(root,'node_modules/jquery/dist/jquery.min.js')).href+'"></script><script>'+script+'</script></body></html>';
        const path = join(dir,'test.html');writeFileSync(path,html);
        const result=spawnSync(chrome,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+join(dir,'profile'),'--dump-dom',pathToFileURL(path).href],{encoding:'utf8',timeout:25000,maxBuffer:2*1024*1024});
        assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/data-result="PASS"/,result.stdout.slice(-1800));
    } finally { rmSync(dir,{recursive:true,force:true}); }
});

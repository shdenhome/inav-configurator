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

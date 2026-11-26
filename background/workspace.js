// background/workspace.js - Container workspace probe, question-specific terminal pre-test runner & setup command runner
import { sanitizePostWriteCommand, detectRequiredPostWriteCommands } from '../utils/commands.js';
import { buildLocalTestSpec } from '../utils/local-test-planner.js';
import {
  decodeTerminalJsonPayload,
  runTerminalCommandWithCapture,
  dispatchCommandToTerminal
} from './terminal.js';

/** Probe container workspace via terminal: reads package.json, prisma schema, .env & grading test files. */
export async function probeWorkspaceViaTerminal(tabId) {
  const probeJs = `
const fs=require('fs'),zlib=require('zlib');
const S='===AP'+'_CTX_START===',E='===AP'+'_CTX_END===';
const out={files:{},allFiles:[]};
let pkgRaw='';
try{
  if(fs.existsSync('package.json')){
    const raw=fs.readFileSync('package.json','utf8');
    try{const p=JSON.parse(raw);pkgRaw=JSON.stringify({name:p.name,main:p.main,type:p.type,scripts:p.scripts,dependencies:p.dependencies,devDependencies:p.devDependencies},null,2);}
    catch(e){pkgRaw=raw.slice(0,2500);}
    out.files['package.json']=pkgRaw;
  }
}catch(e){}
try{if(fs.existsSync('.env'))out.files['.env']=fs.readFileSync('.env','utf8').slice(0,1000);}catch(e){}
try{if(fs.existsSync('nodemon.json'))out.files['nodemon.json']=fs.readFileSync('nodemon.json','utf8').slice(0,600);}catch(e){}
try{if(fs.existsSync('README.md'))out.files['README.md']=fs.readFileSync('README.md','utf8').slice(0,1200);}catch(e){}
const testCands=[],keyCands=[];
function walk(d,depth){
  if(depth>4)return;
  let ents=[];try{ents=fs.readdirSync(d,{withFileTypes:true});}catch(e){return;}
  for(const ent of ents){
    if(ent.name==='node_modules'||ent.name==='.git'||ent.name==='dist'||ent.name==='build')continue;
    const p=d==='.'?ent.name:d+'/'+ent.name;
    if(ent.isDirectory()){walk(p,depth+1);}
    else{
      out.allFiles.push(p);
      if(/(?:^|\\/)(?:test|tests|__tests__)\\/|\\.(?:test|spec)\\.(?:js|ts|mjs|cjs)$/i.test(p))testCands.push(p);
      else if(/\\.prisma$|^(?:db|src|controllers|models|services|routes|middleware)\\/.*\\.(?:js|ts)$|^(?:index|app|server)\\.(?:js|ts|mjs|cjs)$|\\.html?$/i.test(p))keyCands.push(p);
    }
  }
}
walk('.',0);
for(const p of testCands.slice(0,4)){try{out.files[p]=fs.readFileSync(p,'utf8').slice(0,4500);}catch(e){}}
for(const p of keyCands.slice(0,8)){try{if(fs.statSync(p).size<12000)out.files[p]=fs.readFileSync(p,'utf8').slice(0,2200);}catch(e){}}
let gz=zlib.gzipSync(Buffer.from(JSON.stringify(out))).toString('base64');
if(gz.length>1600){
  if(out.files['README.md'])out.files['README.md']=out.files['README.md'].slice(0,500);
  for(const p of keyCands){if(out.files[p]&&p!=='prisma/schema.prisma'&&!p.endsWith('schema.prisma'))out.files[p]=out.files[p].slice(0,1100);}
  for(const p of testCands){if(out.files[p])out.files[p]=out.files[p].slice(0,2800);}
  gz=zlib.gzipSync(Buffer.from(JSON.stringify(out))).toString('base64');
}
if(gz.length>1600){
  delete out.files['README.md'];
  for(const p of keyCands){if(out.files[p]&&p!=='prisma/schema.prisma'&&!p.endsWith('schema.prisma'))out.files[p]=out.files[p].slice(0,650);}
  for(const p of testCands){if(out.files[p])out.files[p]=out.files[p].slice(0,2200);}
  gz=zlib.gzipSync(Buffer.from(JSON.stringify(out))).toString('base64');
}
if(gz.length>1600){
  for(const p of keyCands){if(out.files[p]&&p!=='prisma/schema.prisma'&&!p.endsWith('schema.prisma')&&!/index\\.(js|ts)$/i.test(p))delete out.files[p];}
  gz=zlib.gzipSync(Buffer.from(JSON.stringify(out))).toString('base64');
}
if(gz.length>1600){
  for(const p of keyCands){if(out.files[p]&&p!=='prisma/schema.prisma'&&!p.endsWith('schema.prisma'))delete out.files[p];}
  for(const p of testCands){if(out.files[p])out.files[p]=out.files[p].slice(0,2000);}
  gz=zlib.gzipSync(Buffer.from(JSON.stringify(out))).toString('base64');
}
console.log('\\n'+S+'\\nGZ:'+gz+'\\n'+E);
`.trim();

  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(probeJs).toString('base64') : btoa(unescape(encodeURIComponent(probeJs)));
  const rootCd = `(cd /app/code 2>/dev/null || { _ap_top="$(git rev-parse --show-toplevel 2>/dev/null)"; [ -n "$_ap_top" ] && cd "$_ap_top"; } || true)`;
  const bashCmd = `${rootCd} && (echo "${b64}" | base64 -d | node 2>/dev/null || printf "===AP""_CTX_START===\\nRAW:e30=\\n===AP""_CTX_END===\\n")`;

  const cap = await runTerminalCommandWithCapture(tabId, {
    bashCmd,
    startMarker: '===AP_CTX_START===',
    endMarker: '===AP_CTX_END===',
    timeoutMs: 8000
  });

  if (!cap.ok) return cap;
  const decoded = await decodeTerminalJsonPayload(cap.raw);
  if (!decoded) return { ok: false, error: 'Failed to parse probe payload' };
  return { ok: true, files: decoded.files || {}, allFiles: decoded.allFiles || [] };
}

/** Build the self-contained Node test harness script executed inside the container terminal. */
export function buildLocalTestRunnerScript(targetFiles = [], spec = {}) {
  const cleanTargets = (Array.isArray(targetFiles) ? targetFiles : []).map(f => String(f || '').trim()).filter(Boolean);
  const compactSpec = {
    strategy: spec?.strategy || 'compile_and_smoke',
    language: spec?.language || 'javascript',
    moduleSystem: spec?.moduleSystem || 'commonjs',
    framework: spec?.framework || 'node-cli',
    entryFile: spec?.entryFile || '',
    buildCommands: Array.isArray(spec?.buildCommands) ? spec.buildCommands.slice(0, 6) : [],
    fileChecks: Array.isArray(spec?.fileChecks) ? spec.fileChecks.slice(0, 10) : [],
    expectedExports: Array.isArray(spec?.expectedExports) ? spec.expectedExports.slice(0, 8) : [],
    httpProbes: Array.isArray(spec?.httpProbes) ? spec.httpProbes.slice(0, 12) : [],
    sampleIoCases: Array.isArray(spec?.sampleIoCases) ? spec.sampleIoCases.slice(0, 6) : []
  };

  const childHarnessSource = String.raw`
const fs = require('fs');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const cfg = JSON.parse(process.env.AP_TEST_SPEC || '{}');
const results = { loaded: false, serverBound: false, fatalError: '', cases: [], discoveredRoutes: [] };
const add = (name, input, expected, actual, ok, kind) => {
  results.cases.push({
    name: String(name || '').slice(0, 90),
    input: String(input || '').slice(0, 140),
    expected: String(expected || '').slice(0, 140),
    actual: String(actual || '').slice(0, 180),
    ok: !!ok,
    kind: kind || 'runtime'
  });
};
const finish = (code) => {
  process.stdout.write('__AP_CHILD_JSON__' + JSON.stringify(results) + '__AP_CHILD_END__\n');
  setTimeout(() => process.exit(code), 30).unref();
};
setTimeout(() => {
  if (!results.fatalError) results.fatalError = 'Local runtime harness timed out';
  finish(1);
}, 9000).unref();
const capturedServers = [];
const origListen = http.Server.prototype.listen;
http.Server.prototype.listen = function(...args) {
  if (!capturedServers.includes(this)) capturedServers.push(this);
  const cb = args.find(a => typeof a === 'function');
  return origListen.call(this, 0, '127.0.0.1', cb);
};
async function loadMod(relPath) {
  const abs = path.resolve(relPath);
  try {
    return require(abs);
  } catch (e) {
    if (e && (e.code === 'ERR_REQUIRE_ESM' || /ES Module/i.test(String(e.message || '')))) {
      return await import(pathToFileURL(abs).href);
    }
    throw e;
  }
}
function reqHttp(port, probe) {
  return new Promise((resolve) => {
    const headers = Object.assign({}, probe.headers || {});
    const body = probe.body !== undefined && probe.body !== null ? String(probe.body) : '';
    if (body && !Object.keys(headers).some(k => k.toLowerCase() === 'content-length')) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const r = http.request({ hostname: '127.0.0.1', port, path: probe.path || '/', method: probe.method || 'GET', headers, timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', ch => { if (data.length < 4096) data += ch; });
      res.on('end', () => resolve({ ok: true, statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('timeout', () => { r.destroy(new Error('HTTP timeout')); });
    r.on('error', (err) => resolve({ ok: false, error: err.message || String(err) }));
    if (body) r.write(body);
    r.end();
  });
}
(async () => {
  try {
    for (const expSpec of (cfg.expectedExports || [])) {
      const fp = expSpec.filePath;
      if (!fs.existsSync(fp)) {
        add('Module file exists: ' + fp, fp, 'file exists & exports ' + (expSpec.symbols || []).join(', '), 'FILE NOT FOUND', false, 'export');
        continue;
      }
      try {
        const mod = await loadMod(fp);
        const modObj = (mod && typeof mod === 'object') ? mod : {};
        const defObj = (modObj.default && typeof modObj.default === 'object') ? modObj.default : {};
        for (const sym of (expSpec.symbols || [])) {
          const val = modObj[sym] !== undefined ? modObj[sym] : defObj[sym];
          const ok = val !== undefined;
          add(
            'Export ' + fp + ' -> ' + sym,
            fp,
            sym + ' exported',
            ok ? ('defined (' + typeof val + ')') : ('missing; keys=[' + Object.keys(modObj).join(',') + ']'),
            ok,
            'export'
          );
        }
      } catch (e) {
        add('Import module ' + fp, fp, 'loads cleanly', 'Error: ' + (e.message || String(e)), false, 'export');
      }
    }
    const entry = cfg.entryFile;
    let entryMod = null;
    if (entry && fs.existsSync(entry)) {
      entryMod = await loadMod(entry);
      results.loaded = true;
      await new Promise(r => setTimeout(r, 120));
      add('Startup load: ' + entry, 'node ' + entry, 'loads without unhandled throw', 'loaded cleanly', true, 'startup');
    } else if ((cfg.httpProbes || []).length > 0) {
      add('Startup load: ' + (entry || 'index.js'), entry || 'index.js', 'entrypoint exists', 'MISSING ENTRY FILE', false, 'startup');
      return finish(1);
    }
    const pickApp = (m) => {
      if (!m) return null;
      if (typeof m === 'function' && (m.handle || m.use)) return m;
      if (m.app && typeof m.app === 'function') return m.app;
      if (m.default && typeof m.default === 'function') return m.default;
      return null;
    };
    const app = pickApp(entryMod);
    if (app && app._router && Array.isArray(app._router.stack)) {
      for (const layer of app._router.stack) {
        if (layer && layer.route && layer.route.path) {
          const methods = Object.keys(layer.route.methods || {}).map(m => m.toUpperCase()).join(',');
          results.discoveredRoutes.push((methods || 'ALL') + ' ' + layer.route.path);
        }
      }
    }
    const probes = Array.isArray(cfg.httpProbes) ? cfg.httpProbes.slice() : [];
    const needsHttp = probes.length > 0 || capturedServers.length > 0 || !!app;
    if (needsHttp) {
      let srv = capturedServers.find(s => s && s.listening) || capturedServers[0] || (entryMod && entryMod.server && typeof entryMod.server.listen === 'function' ? entryMod.server : null);
      if (!srv && app) {
        srv = http.createServer(app);
        await new Promise((resolve, reject) => {
          srv.once('error', reject);
          origListen.call(srv, 0, '127.0.0.1', resolve);
        });
      } else if (srv && !srv.listening && typeof srv.listen === 'function') {
        await new Promise((resolve, reject) => {
          srv.once('error', reject);
          if (srv.address()) return resolve();
          origListen.call(srv, 0, '127.0.0.1', resolve);
        });
      } else if (srv && srv.listening && !srv.address()) {
        await new Promise(r => srv.once('listening', r));
      }
      const addr = srv && typeof srv.address === 'function' ? srv.address() : null;
      const port = addr && addr.port ? addr.port : 0;
      if (!port) {
        if (probes.length > 0) {
          add('HTTP server bind', entry || 'server', 'binds listening port', 'No active HTTP server exported or listening', false, 'http');
        }
      } else {
        results.serverBound = true;
        if (probes.length === 0) {
          probes.push({ name: 'Server live HTTP ping (no 5xx)', method: 'GET', path: '/__ap_probe_ping__', expectedMaxStatus: 499 });
        }
        for (const p of probes) {
          const res = await reqHttp(port, p);
          const inputDesc = (p.method || 'GET') + ' ' + (p.path || '/') + (p.body ? ' body=' + p.body : '');
          const expParts = [];
          if (Array.isArray(p.expectedStatuses) && p.expectedStatuses.length) expParts.push('status in [' + p.expectedStatuses.join('/') + ']');
          else if (p.expectedMaxStatus) expParts.push('status <= ' + p.expectedMaxStatus);
          if (p.expectedContentType) expParts.push('Content-Type~' + p.expectedContentType);
          if (p.expectedBodyIncludes) expParts.push('body~"' + p.expectedBodyIncludes + '"');
          if (!res.ok) {
            add(p.name || inputDesc, inputDesc, expParts.join(', '), 'Request Error: ' + res.error, false, 'http');
            continue;
          }
          const ct = String(res.headers['content-type'] || '').toLowerCase();
          let ok = true;
          const failReasons = [];
          if (Array.isArray(p.expectedStatuses) && p.expectedStatuses.length && !p.expectedStatuses.includes(res.statusCode)) {
            ok = false; failReasons.push('got status ' + res.statusCode);
          } else if (p.expectedMaxStatus && res.statusCode > p.expectedMaxStatus) {
            ok = false; failReasons.push('got 5xx status ' + res.statusCode);
          }
          if (p.expectedContentType && !ct.includes(p.expectedContentType.toLowerCase())) {
            ok = false; failReasons.push('Content-Type=' + (ct || 'none'));
          }
          if (p.expectedBodyIncludes && !String(res.body || '').toLowerCase().includes(p.expectedBodyIncludes.toLowerCase())) {
            ok = false; failReasons.push('missing "' + p.expectedBodyIncludes + '" in body');
          }
          const bodyPreview = String(res.body || '').replace(/\s+/g, ' ').trim().slice(0, 75);
          const actualDesc = 'HTTP ' + res.statusCode + (ct ? ' [' + ct.split(';')[0] + ']' : '') + (bodyPreview ? ' ' + bodyPreview : '') + (failReasons.length ? ' (' + failReasons.join('; ') + ')' : '');
          add(p.name || inputDesc, inputDesc, expParts.join(', ') || 'responds cleanly', actualDesc, ok, 'http');
        }
      }
      if (srv && typeof srv.close === 'function') {
        try { srv.close(); } catch (e) {}
      }
    }
    finish(results.cases.some(c => !c.ok) ? 1 : 0);
  } catch (err) {
    results.fatalError = (err && (err.stack || err.message)) ? String(err.stack || err.message).slice(0, 800) : String(err);
    add('Startup / Runtime crash: ' + (cfg.entryFile || ''), cfg.entryFile || '', 'runs without runtime error', results.fatalError.split('\n')[0], false, 'startup');
    finish(1);
  }
})();
`.trim();

  const runnerJs = `
const fs=require('fs'),zlib=require('zlib'),{spawnSync}=require('child_process');
const S='===AP'+'_LTEST_START===',E='===AP'+'_LTEST_END===';
const targets=${JSON.stringify(cleanTargets)};
const spec=${JSON.stringify(compactSpec)};
const childCode=${JSON.stringify(childHarnessSource)};
const executedCommands=[];
const cases=[];
const logs=[];
let compileResult={ok:true,command:'',output:''};
let runtimeResult={ok:true,command:'',output:''};
const addCase=(name,input,expected,actual,ok,kind)=>{
  const rec={name:String(name||'').slice(0,90),input:String(input||'').slice(0,140),expected:String(expected||'').slice(0,140),actual:String(actual||'').slice(0,180),ok:!!ok,kind:kind||'check'};
  cases.push(rec);
  const mark=rec.ok?'PASS':'FAIL';
  logs.push('['+mark+'] '+rec.name+' | input='+rec.input+' | expected='+rec.expected+' | actual='+rec.actual);
  console.log('[Local Test]['+spec.strategy+'] '+mark+' '+rec.name+(rec.ok?'':' -> expected: '+rec.expected+' | actual: '+rec.actual));
};
const emit=(obj)=>{
  let slimCases=Array.isArray(obj.cases)?obj.cases.slice(0,14).map(c=>({
    name:String(c.name||'').slice(0,70),
    input:String(c.input||'').slice(0,90),
    expected:String(c.expected||'').slice(0,90),
    actual:String(c.actual||'').slice(0,120),
    ok:!!c.ok,
    kind:c.kind||''
  })):[];
  let lim=5000,gz='';
  while(lim>=400){
    const payload={...obj,cases:slimCases,output:String(obj.output||'').slice(-lim)};
    gz=zlib.gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64');
    if(gz.length<=1650)break;
    lim=Math.floor(lim*0.6);
    if(lim<1200&&slimCases.length>6){
      const fails=slimCases.filter(c=>!c.ok);
      const passes=slimCases.filter(c=>c.ok);
      slimCases=[...fails,...passes].slice(0,6);
    }
  }
  console.log('\\n[Local Test] strategy='+(obj.strategy||spec.strategy)+' pass='+(obj.passed||0)+' fail='+(obj.failed||0)+' exit='+(obj.exitCode??0));
  console.log(S+'\\nGZ:'+gz+'\\n'+E);
  process.exit(0);
};
const walk=(d,dep)=>{let o=[];if(dep>3||!fs.existsSync(d))return o;for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='node_modules'||e.name==='.git'||e.name==='dist'||e.name==='build')continue;const p=d==='.'?e.name:d+'/'+e.name;if(e.isDirectory())o.push(...walk(p,dep+1));else if(/\\.(?:js|mjs|cjs|ts|tsx|py|prisma)$/i.test(e.name))o.push(p);}return o;};
const allDisk=walk('.',0);
const jsCandidates=[...new Set([...targets.filter(f=>/\\.(?:js|mjs|cjs)$/i.test(f)),...allDisk.filter(f=>/\\.(?:js|mjs|cjs)$/i.test(f))])].filter(f=>fs.existsSync(f));
const pyCandidates=[...new Set([...targets.filter(f=>/\\.py$/i.test(f)),...allDisk.filter(f=>/\\.py$/i.test(f))])].filter(f=>fs.existsSync(f));
const tsCandidates=[...new Set([...targets.filter(f=>/\\.tsx?$/i.test(f)),...allDisk.filter(f=>/\\.tsx?$/i.test(f))])].filter(f=>fs.existsSync(f));
const prismaCandidates=allDisk.filter(f=>/\\.prisma$/i.test(f)&&fs.existsSync(f));

let pkgRaw='';let pkg={};try{pkgRaw=fs.readFileSync('package.json','utf8');pkg=JSON.parse(pkgRaw);}catch(e){}
const script=(pkg.scripts&&pkg.scripts.test)||'';
const hasScript=Boolean(script&&!/no test specified/i.test(script));
const dirs=['test','tests','__tests__','src/__tests__','src/test'].filter(d=>fs.existsSync(d)&&fs.readdirSync(d).some(f=>/\\.(?:js|ts|mjs|cjs|py)$/i.test(f)));
const rootTests=fs.readdirSync('.').filter(f=>/\\.(test|spec)\\.(?:js|ts|mjs|cjs|py)$/i.test(f));
const needsMissingTestDir=/__tests__|tests?\\//i.test(script)&&dirs.length===0&&rootTests.length===0;

const rawDiskCheck=()=>{
  const miss=targets.filter(t=>!fs.existsSync(t));
  for(const m of miss){addCase('Target file written to disk: '+m,m,'file exists & non-empty','MISSING ON DISK',false,'disk');}
  return miss;
};
const missingTargets=rawDiskCheck();
if(missingTargets.length>0){
  emit({skip:false,strategy:spec.strategy,pkgRaw,executedCommands:['disk check'],compileResult:{ok:false,command:'disk check',output:'Missing written file(s): '+missingTargets.join(', ')},runtimeResult:{ok:false,command:'',output:''},cases,isSyntaxError:false,exitCode:1,passed:0,failed:missingTargets.length,output:logs.join('\\n')});
}
if(jsCandidates.length===0&&pyCandidates.length===0&&tsCandidates.length===0&&dirs.length===0&&rootTests.length===0){
  const p=zlib.gzipSync(Buffer.from(JSON.stringify({skip:true}))).toString('base64');
  console.log('\\n'+S+'\\nGZ:'+p+'\\n'+E);
  process.exit(0);
}

// Phase 1: Compilation & Syntax verification
if(pyCandidates.length>0&&jsCandidates.length===0){
  const pyCmd='python3 -m py_compile '+pyCandidates.map(f=>JSON.stringify(f)).join(' ');
  executedCommands.push(pyCmd);
  const pyChk=spawnSync('python3',['-m','py_compile',...pyCandidates],{encoding:'utf8',timeout:8000});
  const pyOut=((pyChk.stderr||'')+'\\n'+(pyChk.stdout||'')).trim();
  if(pyChk.status!==0){
    compileResult={ok:false,command:pyCmd,output:pyOut};
    addCase('Python syntax check',pyCmd,'exit 0',pyOut||'syntax error',false,'compile');
    emit({skip:false,strategy:spec.strategy,pkgRaw,executedCommands,compileResult,runtimeResult:{ok:false,command:'',output:'Skipped due to compile error'},cases,isSyntaxError:true,exitCode:1,passed:0,failed:1,output:logs.join('\\n')+'\\n'+pyOut});
  }
  compileResult={ok:true,command:pyCmd,output:'Python syntax check passed'};
  addCase('Python syntax check',pyCmd,'exit 0','ok ('+pyCandidates.length+' files)',true,'compile');
}
if(jsCandidates.length>0){
  const synCmd='node --check '+jsCandidates.join(' ');
  executedCommands.push(synCmd);
  for(const f of jsCandidates){
    const chk=spawnSync('node',['--check',f],{encoding:'utf8',timeout:5000});
    if(chk.status!==0){
      const errOut=((chk.stderr||chk.stdout||'')).trim();
      compileResult={ok:false,command:'node --check '+f,output:errOut};
      addCase('Syntax check: '+f,'node --check '+f,'exit 0',errOut.split('\\n')[0]||'SyntaxError',false,'compile');
      emit({skip:false,strategy:spec.strategy,pkgRaw,executedCommands,compileResult,runtimeResult:{ok:false,command:'',output:'Skipped due to syntax error'},cases,isSyntaxError:true,exitCode:1,passed:0,failed:1,output:'SyntaxError in '+f+':\\n'+errOut});
    }
  }
  compileResult={ok:true,command:synCmd,output:'Passed node --check on '+jsCandidates.length+' file(s)'};
  addCase('JS syntax check ('+jsCandidates.length+' files)',synCmd,'all valid syntax','exit 0',true,'compile');
}
if(tsCandidates.length>0&&(fs.existsSync('node_modules/.bin/tsc')||(pkg.scripts&&pkg.scripts.build))){
  const tsCmd=(pkg.scripts&&pkg.scripts.build)?'npm run build':'npx --no-install tsc --noEmit';
  executedCommands.push(tsCmd);
  const tsr=spawnSync('sh',['-c',tsCmd],{encoding:'utf8',timeout:20000});
  const tsOut=((tsr.stdout||'')+'\\n'+(tsr.stderr||'')).trim();
  if((tsr.status??1)!==0){
    compileResult={ok:false,command:tsCmd,output:tsOut};
    addCase('TypeScript compile',tsCmd,'exit 0',tsOut.slice(0,180),false,'compile');
    emit({skip:false,strategy:spec.strategy,pkgRaw,executedCommands,compileResult,runtimeResult:{ok:false,command:'',output:''},cases,isSyntaxError:true,exitCode:1,passed:cases.filter(c=>c.ok).length,failed:1,output:logs.join('\\n')+'\\n'+tsOut});
  }
  addCase('TypeScript compile',tsCmd,'exit 0','ok',true,'compile');
}
if(prismaCandidates.length>0&&fs.existsSync('node_modules/.bin/prisma')){
  const prCmd='npx --no-install prisma validate';
  executedCommands.push(prCmd);
  const prr=spawnSync('sh',['-c',prCmd],{encoding:'utf8',timeout:12000});
  const prOut=((prr.stdout||'')+'\\n'+(prr.stderr||'')).trim();
  const prOk=(prr.status??1)===0;
  addCase('Prisma schema validation',prCmd,'valid schema',prOk?'valid':prOut.slice(0,160),prOk,'compile');
  if(!prOk){
    compileResult={ok:false,command:prCmd,output:prOut};
    emit({skip:false,strategy:spec.strategy,pkgRaw,executedCommands,compileResult,runtimeResult:{ok:false,command:'',output:''},cases,isSyntaxError:false,exitCode:1,passed:cases.filter(c=>c.ok).length,failed:1,output:logs.join('\\n')+'\\n'+prOut});
  }
}

// Phase 2: Required file & HTML content checks
for(const fc of (spec.fileChecks||[])){
  if(!fc||!fc.filePath)continue;
  if(!fs.existsSync(fc.filePath)){
    addCase('Required file: '+fc.filePath,fc.filePath,'file exists on disk'+(fc.mustContain?' containing "'+fc.mustContain+'"':''),'MISSING FILE',false,'file');
    continue;
  }
  const txt=fs.readFileSync(fc.filePath,'utf8');
  if(fc.mustContain){
    const has=txt.toLowerCase().includes(fc.mustContain.toLowerCase());
    addCase('File content: '+fc.filePath,fc.filePath,'contains "'+fc.mustContain+'"',has?'matched':'got: '+txt.replace(/\\s+/g,' ').trim().slice(0,90),has,'file');
  }else{
    addCase('Required file: '+fc.filePath,fc.filePath,'file exists & non-empty',txt.trim().length+' bytes',txt.trim().length>0,'file');
  }
}

// Phase 3: Full container test suite if local tests exist
if(!((!hasScript||needsMissingTestDir)&&dirs.length===0&&rootTests.length===0)){
  const cmd=hasScript?'npm test':('npx -y mocha '+(dirs.length?dirs.map(d=>"'"+d+"/**/*.{js,ts}'").join(' '):"'*.test.js'"));
  executedCommands.push(cmd);
  const r=spawnSync('sh',['-c',cmd],{encoding:'utf8',timeout:28000,env:{...process.env,NODE_ENV:'test',CI:'true'}});
  const raw=((r.stdout||'')+'\\n'+(r.stderr||'')).replace(/\\x1b\\[[0-9;]*m/g,'');
  const clean=raw.split('\\n').filter(l=>!/^\\s*at .*(?:node_modules|node:internal)/.test(l)).join('\\n');
  const passM=raw.match(/(\\d+)\\s+passing/i);
  const failM=raw.match(/(\\d+)\\s+failing/i);
  const jestFailM=raw.match(/Tests:\\s*(\\d+)\\s+failed/i);
  const passedCount=(passM?parseInt(passM[1],10):0)+cases.filter(c=>c.ok).length;
  const suiteFailed=failM?parseInt(failM[1],10):(jestFailM?parseInt(jestFailM[1],10):(r.status===0?0:1));
  const fileCheckFails=cases.filter(c=>!c.ok).length;
  const totalFailed=suiteFailed+fileCheckFails;
  const timedOut=!!(r.error&&r.error.code==='ETIMEDOUT');
  runtimeResult={ok:r.status===0&&!timedOut,command:cmd,output:clean.slice(-1500)};
  addCase('Project test suite ('+cmd+')',cmd,'all tests pass','pass='+(passM?passM[1]:'?')+' fail='+suiteFailed,r.status===0&&suiteFailed===0&&!timedOut,'suite');
  emit({skip:false,strategy:'project_test_suite',pkgRaw,executedCommands,compileResult,runtimeResult,cases,exitCode:totalFailed>0?1:(r.status===null?1:r.status),timedOut,passed:passedCount,failed:totalFailed,output:(logs.join('\\n')+'\\n\\n'+clean).trim()});
}

// Phase 4A: Python CLI I/O tests
if(pyCandidates.length>0&&jsCandidates.length===0){
  const entry=fs.existsSync(spec.entryFile)?spec.entryFile:pyCandidates[0];
  const ioCases=Array.isArray(spec.sampleIoCases)&&spec.sampleIoCases.length?spec.sampleIoCases:[{name:'Python script execution',input:'',expectedOutput:''}];
  for(const tc of ioCases){
    const cmd='python3 '+entry;
    executedCommands.push(cmd);
    const pr=spawnSync('python3',[entry],{input:tc.input||'',encoding:'utf8',timeout:6000});
    const out=(pr.stdout||'').trim();
    const err=(pr.stderr||'').trim();
    if((pr.status??1)!==0){
      addCase(tc.name||'Python run',tc.input||'(empty stdin)',tc.expectedOutput||'exit 0','exit='+(pr.status??1)+' '+err.slice(0,120),false,'cli');
    }else if(tc.expectedOutput){
      const match=out===tc.expectedOutput.trim()||out.includes(tc.expectedOutput.trim());
      addCase(tc.name||'Sample I/O',tc.input.replace(/\\n/g,'\\\\n'),tc.expectedOutput.trim(),out||'(empty stdout)',match,'cli');
    }else{
      addCase(tc.name||'Python run','(empty stdin)','clean exit 0','exit 0 stdout='+out.slice(0,60),true,'cli');
    }
  }
  const passed=cases.filter(c=>c.ok).length,failed=cases.filter(c=>!c.ok).length;
  runtimeResult={ok:failed===0,command:executedCommands[executedCommands.length-1]||'',output:logs.join('\\n')};
  emit({skip:false,strategy:spec.strategy,pkgRaw,executedCommands,compileResult,runtimeResult,cases,exitCode:failed>0?1:0,passed,failed,output:logs.join('\\n')});
}

// Phase 4B: Node CLI stdin/stdout I/O tests (for non-HTTP script/algorithm questions)
const resolvedEntry=(spec.entryFile&&fs.existsSync(spec.entryFile))?spec.entryFile:(jsCandidates.find(f=>/^(?:src\\/)?index\\.(?:js|mjs)$/i.test(f))||jsCandidates[0]||'');
if(spec.framework==='node-cli'&&Array.isArray(spec.sampleIoCases)&&spec.sampleIoCases.length>0&&resolvedEntry){
  for(const tc of spec.sampleIoCases){
    const cmd='node '+resolvedEntry;
    executedCommands.push(cmd);
    const nr=spawnSync('node',[resolvedEntry],{input:tc.input||'',encoding:'utf8',timeout:6000});
    const out=(nr.stdout||'').trim();
    const err=(nr.stderr||'').trim();
    if((nr.status??1)!==0){
      addCase(tc.name||'Node CLI I/O',tc.input.replace(/\\n/g,'\\\\n'),tc.expectedOutput||'exit 0','exit='+(nr.status??1)+' '+err.slice(0,140),false,'cli');
    }else{
      const match=out===tc.expectedOutput.trim()||out.includes(tc.expectedOutput.trim());
      addCase(tc.name||'Node CLI I/O',tc.input.replace(/\\n/g,'\\\\n'),tc.expectedOutput.trim(),out||'(empty stdout)',match,'cli');
    }
  }
  const passed=cases.filter(c=>c.ok).length,failed=cases.filter(c=>!c.ok).length;
  runtimeResult={ok:failed===0,command:executedCommands[executedCommands.length-1]||'',output:logs.join('\\n')};
  emit({skip:false,strategy:spec.strategy,pkgRaw,executedCommands,compileResult,runtimeResult,cases,exitCode:failed>0?1:0,passed,failed,output:logs.join('\\n')});
}

// Phase 4C: Live Node Module Exports + Startup + Express/HTTP Route Execution
const harnessPayload={
  entryFile:resolvedEntry,
  hasHttpServer:(spec.framework==='express'||spec.framework==='node-http'||spec.framework==='node-http-static'||(spec.httpProbes&&spec.httpProbes.length>0)),
  expectedExports:spec.expectedExports||[],
  httpProbes:spec.httpProbes||[]
};
const runCmd='NODE_ENV=test PORT=0 node <local-harness '+(resolvedEntry||'workspace')+'>';
executedCommands.push(runCmd);
const ch=spawnSync('node',['-e',childCode],{
  encoding:'utf8',
  timeout:11000,
  env:{...process.env,NODE_ENV:'test',PORT:'0',AP_TEST_SPEC:JSON.stringify(harnessPayload)}
});
const chOut=((ch.stdout||'')+'\\n'+(ch.stderr||'')).trim();
const m=chOut.match(/__AP_CHILD_JSON__([\\s\\S]*?)__AP_CHILD_END__/);
if(m){
  try{
    const childData=JSON.parse(m[1]);
    for(const cc of (childData.cases||[])){
      addCase(cc.name,cc.input,cc.expected,cc.actual,cc.ok,cc.kind);
    }
    if(childData.discoveredRoutes&&childData.discoveredRoutes.length){
      logs.push('Discovered Express routes: '+childData.discoveredRoutes.join(', '));
    }
    if(childData.fatalError){
      logs.push('Runtime Exception:\\n'+childData.fatalError);
    }
  }catch(e){
    addCase('Parse runtime harness output',runCmd,'valid report','Parse error: '+e.message,false,'runtime');
  }
}else{
  const errSnippet=chOut.replace(/__AP_CHILD_JSON__[\\s\\S]*/,'').trim()||('child exited '+ch.status);
  addCase('Runtime harness execution',runCmd,'completes cleanly',errSnippet.slice(0,180),false,'runtime');
}
const passed=cases.filter(c=>c.ok).length;
const failed=cases.filter(c=>!c.ok).length;
runtimeResult={ok:failed===0,command:runCmd,output:logs.join('\\n').slice(-1500)};
emit({
  skip:false,
  strategy:spec.strategy,
  pkgRaw,
  executedCommands,
  compileResult,
  runtimeResult,
  cases,
  exitCode:failed>0?1:0,
  timedOut:!!(ch.error&&ch.error.code==='ETIMEDOUT'),
  passed,
  failed,
  output:(logs.join('\\n')+(ch.stderr?'\\n[stderr]\\n'+ch.stderr.slice(-800):'')).trim()
});
`.trim();

  return runnerJs;
}

/** Run syntax/compile check, container test suite, AND question-specific runtime/HTTP/I-O verification BEFORE remote Submit. */
export async function runLocalTestsViaTerminal(tabId, filesOrOptions = [], maybeSpec = null) {
  let targetFiles = [];
  let providedSpec = maybeSpec;
  let specInputs = null;

  if (Array.isArray(filesOrOptions)) {
    targetFiles = filesOrOptions;
  } else if (filesOrOptions && typeof filesOrOptions === 'object') {
    targetFiles = filesOrOptions.files || [];
    providedSpec = filesOrOptions.spec || maybeSpec || null;
    specInputs = filesOrOptions;
  }

  const spec = providedSpec || buildLocalTestSpec({
    questionTitle: specInputs?.questionTitle || '',
    questionDetails: specInputs?.questionDetails || '',
    testCases: specInputs?.testCases || [],
    filesToWrite: targetFiles,
    referenceFiles: specInputs?.referenceFiles || [],
    packageJsonStr: specInputs?.packageJsonStr || '',
    terminalPreAnalysis: specInputs?.terminalPreAnalysis || null
  });

  const runnerJs = buildLocalTestRunnerScript(targetFiles, spec);
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(runnerJs).toString('base64') : btoa(unescape(encodeURIComponent(runnerJs)));
  const rootCd = `(cd /app/code 2>/dev/null || { _ap_top="$(git rev-parse --show-toplevel 2>/dev/null)"; [ -n "$_ap_top" ] && cd "$_ap_top"; } || true)`;

  let cap = await runTerminalCommandWithCapture(tabId, {
    bashCmd: `${rootCd} && echo "${b64}" | base64 -d | node`,
    startMarker: '===AP_LTEST_START===',
    endMarker: '===AP_LTEST_END===',
    timeoutMs: 38000
  });

  // One clean retry if terminal buffer just settled after file write
  if (!cap.ok && cap.unreadable) {
    await new Promise(r => setTimeout(r, 400));
    cap = await runTerminalCommandWithCapture(tabId, {
      bashCmd: `${rootCd} && echo "${b64}" | base64 -d | node`,
      startMarker: '===AP_LTEST_START===',
      endMarker: '===AP_LTEST_END===',
      timeoutMs: 38000
    });
  }

  if (!cap.ok) {
    return {
      ok: false,
      status: cap.unreadable ? 'unreadable' : 'error',
      strategy: spec.strategy,
      error: cap.error
    };
  }

  const decoded = await decodeTerminalJsonPayload(cap.raw);
  if (!decoded) {
    return { ok: false, status: 'unreadable', strategy: spec.strategy, error: 'Could not decode local test payload' };
  }
  if (decoded.skip) {
    return { ok: true, status: 'no_local_tests', strategy: spec.strategy };
  }

  const allPassed = decoded.exitCode === 0 && decoded.failed === 0 && !decoded.timedOut;
  const autoFixCommands = allPassed
    ? []
    : detectRequiredPostWriteCommands({
        packageJsonStr: decoded.pkgRaw || '',
        filesToWrite: (targetFiles || []).map(f => ({ filePath: f })),
        lastErrorOutput: decoded.output || ''
      });

  return {
    ok: true,
    status: allPassed ? 'passed' : 'failed',
    strategy: decoded.strategy || spec.strategy,
    executedCommands: decoded.executedCommands || [],
    compileResult: decoded.compileResult || null,
    runtimeResult: decoded.runtimeResult || null,
    cases: decoded.cases || [],
    exitCode: decoded.exitCode,
    passed: decoded.passed || 0,
    failed: decoded.failed || 0,
    timedOut: decoded.timedOut,
    isSyntaxError: !!decoded.isSyntaxError,
    autoFixCommands,
    output: decoded.output || ''
  };
}

/** Execute safe setup/build/migration/remediation commands in container terminal and capture verified exit codes + output. */
export async function runTerminalCommandsViaTerminal(tabId, commands = []) {
  const cleanCmds = (Array.isArray(commands) ? commands : [])
    .map(c => sanitizePostWriteCommand(c))
    .filter(Boolean);
  if (cleanCmds.length === 0) {
    return { ok: true, verified: true, ran: [], exitCode: 0, output: '' };
  }

  const runnerJs = `
const zlib=require('zlib'),{spawnSync}=require('child_process');
const S='===AP'+'_CMD_START===',E='===AP'+'_CMD_END===';
const cmds=${JSON.stringify(cleanCmds)};
const logs=[];let lastCode=0;const failedCmds=[];
for(const c of cmds){
  const r=spawnSync('sh',['-c',c],{encoding:'utf8',timeout:40000,env:{...process.env,CI:'true'}});
  const code=(r.status===null?1:r.status);
  const out=((r.stdout||'')+'\\n'+(r.stderr||'')).trim();
  logs.push('$ '+c+' (exit='+code+')\\n'+out.slice(-1200));
  if(code!==0){lastCode=code;failedCmds.push({command:c,exitCode:code,output:out.slice(-600)});}
}
if(lastCode===0){
  spawnSync('sh',['-c','(rm -f .git/index.lock 2>/dev/null; git config user.email "solver@ap.dev" 2>/dev/null; git config user.name "AP-Solver" 2>/dev/null; git add -A && git commit -m "post-commands" 2>/dev/null || true)'],{encoding:'utf8',timeout:8000});
}
const full=logs.join('\\n');
let lim=4000,gz='';
while(lim>=600){gz=zlib.gzipSync(Buffer.from(JSON.stringify({exitCode:lastCode,ran:cmds,failedCmds,cwd:process.cwd(),output:full.slice(-lim)}))).toString('base64');if(gz.length<=1650)break;lim=Math.floor(lim*0.65);}
console.log('\\n'+S+'\\nGZ:'+gz+'\\n'+E);
`.trim();

  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(runnerJs).toString('base64') : btoa(unescape(encodeURIComponent(runnerJs)));
  const rootCd = `(cd /app/code 2>/dev/null || { _ap_top="$(git rev-parse --show-toplevel 2>/dev/null)"; [ -n "$_ap_top" ] && cd "$_ap_top"; } || true)`;
  const cap = await runTerminalCommandWithCapture(tabId, {
    bashCmd: `${rootCd} && echo "${b64}" | base64 -d | node`,
    startMarker: '===AP_CMD_START===',
    endMarker: '===AP_CMD_END===',
    timeoutMs: 48000
  });

  if (cap.ok) {
    const decoded = await decodeTerminalJsonPayload(cap.raw);
    if (decoded) {
      return {
        ok: decoded.exitCode === 0,
        verified: true,
        ran: decoded.ran || cleanCmds,
        failedCmds: decoded.failedCmds || [],
        cwd: decoded.cwd || '',
        exitCode: decoded.exitCode || 0,
        output: decoded.output || ''
      };
    }
  }

  if (cap.unreadable) {
    const chained = `${rootCd} && ` + cleanCmds.map(c => c).join(' && ') + ' && (rm -f .git/index.lock 2>/dev/null; git add -A && git commit -m "solution" 2>/dev/null || true)';
    const disp = await dispatchCommandToTerminal(tabId, chained, 3000);
    // Do NOT claim verified success when terminal output could not be read!
    return {
      ok: false,
      verified: false,
      unreadable: true,
      ran: cleanCmds,
      exitCode: null,
      error: cap.error || 'Command dispatched via terminal, but output/exit code could not be captured for verification.',
      output: '',
      fallbackDispatched: !!disp?.ok
    };
  }

  return { ok: false, verified: false, ran: cleanCmds, exitCode: 1, output: cap.error || 'Command runner failed' };
}

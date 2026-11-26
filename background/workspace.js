// background/workspace.js - Container workspace probe, local syntax/Mocha pre-test runner & setup command runner
import { sanitizePostWriteCommand, detectRequiredPostWriteCommands } from '../utils/commands.js';
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
  for(const p of keyCands){if(out.files[p]&&p!=='prisma/schema.prisma'&&!p.endsWith('schema.prisma'))out.files[p]=out.files[p].slice(0,1100);}
  for(const p of testCands){if(out.files[p])out.files[p]=out.files[p].slice(0,2800);}
  gz=zlib.gzipSync(Buffer.from(JSON.stringify(out))).toString('base64');
}
if(gz.length>1600){
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
  const bashCmd = `echo "${b64}" | base64 -d | node 2>/dev/null || printf "===AP""_CTX_START===\\nRAW:e30=\\n===AP""_CTX_END===\\n"`;

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

/** Run syntax check, local container test suite (`npm test`), and safe startup smoke check BEFORE slow Remote Submit. */
export async function runLocalTestsViaTerminal(tabId, targetFiles = []) {
  const jsFilesJson = JSON.stringify((targetFiles || []).filter(f => /\.js$/i.test(f)));
  const runnerJs = `
const fs=require('fs'),zlib=require('zlib'),{spawnSync}=require('child_process');
const S='===AP'+'_LTEST_START===',E='===AP'+'_LTEST_END===';
const emit=(obj)=>{let lim=8000,gz='';while(lim>=1000){const p={...obj,output:(obj.output||'').slice(-lim)};gz=zlib.gzipSync(Buffer.from(JSON.stringify(p))).toString('base64');if(gz.length<=1650)break;lim=Math.floor(lim*0.65);}console.log('\\n[Local Test] pass='+(obj.passed||0)+' fail='+(obj.failed||0)+' exit='+(obj.exitCode??0));console.log(S+'\\nGZ:'+gz+'\\n'+E);process.exit(0);};
const targets=${jsFilesJson};
const walkJs=(d,dep)=>{let o=[];if(dep>3||!fs.existsSync(d))return o;for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='node_modules'||e.name==='.git')continue;const p=d+'/'+e.name;if(e.isDirectory())o.push(...walkJs(p,dep+1));else if(/\\.js$/i.test(e.name))o.push(p);}return o;};
const syntaxCandidates=[...new Set([...targets,...walkJs('src',0)])].filter(f=>fs.existsSync(f));
for(const f of syntaxCandidates){
  const chk=spawnSync('node',['--check',f],{encoding:'utf8',timeout:5000});
  if(chk.status!==0){emit({skip:false,isSyntaxError:true,exitCode:1,passed:0,failed:1,output:'SyntaxError in '+f+':\\n'+((chk.stderr||chk.stdout||'').trim())});}
}
let pkgRaw='';let pkg={};try{pkgRaw=fs.readFileSync('package.json','utf8');pkg=JSON.parse(pkgRaw);}catch(e){}
const script=(pkg.scripts&&pkg.scripts.test)||'';
const hasScript=Boolean(script&&!/no test specified/i.test(script));
const dirs=['test','tests','__tests__','src/__tests__','src/test'].filter(d=>fs.existsSync(d)&&fs.readdirSync(d).some(f=>/\\.(?:js|ts|mjs|cjs)$/i.test(f)));
const rootTests=fs.readdirSync('.').filter(f=>/\\.(test|spec)\\.(js|ts|mjs|cjs)$/i.test(f));
const needsMissingTestDir=/__tests__|tests?\\//i.test(script)&&dirs.length===0&&rootTests.length===0;
if((!hasScript||needsMissingTestDir)&&dirs.length===0&&rootTests.length===0){
  const entry=syntaxCandidates.find(f=>/^(?:src\\/)?index\\.js$/i.test(f))||syntaxCandidates[0];
  if(entry&&pkg.type!=='module'){
    const probeCode='process.on("uncaughtException",e=>{if(e&&e.code==="EADDRINUSE")process.exit(0);console.error(e);process.exit(1);});setTimeout(()=>process.exit(0),250);require("./"+'+JSON.stringify(entry)+');';
    const smk=spawnSync('node',['-e',probeCode],{encoding:'utf8',timeout:2500,env:{...process.env,NODE_ENV:'test',PORT:'0'}});
    const smkOut=((smk.stderr||'')+'\\n'+(smk.stdout||'')).trim();
    if(/Cannot find module|SyntaxError|ReferenceError|TypeError|PrismaClientInitializationError|did not initialize/i.test(smkOut)){
      emit({skip:false,pkgRaw,exitCode:1,passed:0,failed:1,output:'Startup Load Failure ('+entry+'):\\n'+smkOut});
    }
  }
  const p=zlib.gzipSync(Buffer.from(JSON.stringify({skip:true}))).toString('base64');
  console.log('\\n'+S+'\\nGZ:'+p+'\\n'+E);
  process.exit(0);
}
const cmd=hasScript?'npm test':('npx -y mocha '+(dirs.length?dirs.map(d=>"'"+d+"/**/*.{js,ts}'").join(' '):"'*.test.js'"));
const r=spawnSync('sh',['-c',cmd],{encoding:'utf8',timeout:28000,env:{...process.env,NODE_ENV:'test',CI:'true'}});
const raw=((r.stdout||'')+'\\n'+(r.stderr||'')).replace(/\\x1b\\[[0-9;]*m/g,'');
const clean=raw.split('\\n').filter(l=>!/^\\s*at .*(?:node_modules|node:internal)/.test(l)).join('\\n');
const passM=raw.match(/(\\d+)\\s+passing/i);
const failM=raw.match(/(\\d+)\\s+failing/i);
const jestFailM=raw.match(/Tests:\\s*(\\d+)\\s+failed/i);
const passed=passM?parseInt(passM[1],10):0;
const failed=failM?parseInt(failM[1],10):(jestFailM?parseInt(jestFailM[1],10):(r.status===0?0:1));
const timedOut=!!(r.error&&r.error.code==='ETIMEDOUT');
emit({skip:false,pkgRaw,exitCode:r.status===null?1:r.status,timedOut,passed,failed,output:clean});
`.trim();

  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(runnerJs).toString('base64') : btoa(unescape(encodeURIComponent(runnerJs)));
  const cap = await runTerminalCommandWithCapture(tabId, {
    bashCmd: `echo "${b64}" | base64 -d | node`,
    startMarker: '===AP_LTEST_START===',
    endMarker: '===AP_LTEST_END===',
    timeoutMs: 36000
  });

  if (!cap.ok) {
    return { ok: false, status: cap.unreadable ? 'unreadable' : 'error', error: cap.error };
  }

  const decoded = await decodeTerminalJsonPayload(cap.raw);
  if (!decoded) {
    return { ok: false, status: 'unreadable', error: 'Could not decode local test payload' };
  }
  if (decoded.skip) {
    return { ok: true, status: 'no_local_tests' };
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
    exitCode: decoded.exitCode,
    passed: decoded.passed || 0,
    failed: decoded.failed || 0,
    timedOut: decoded.timedOut,
    isSyntaxError: !!decoded.isSyntaxError,
    autoFixCommands,
    output: decoded.output || ''
  };
}

/** Execute safe setup/build/migration/remediation commands in container terminal and capture structured results. */
export async function runTerminalCommandsViaTerminal(tabId, commands = []) {
  const cleanCmds = (Array.isArray(commands) ? commands : [])
    .map(c => sanitizePostWriteCommand(c))
    .filter(Boolean);
  if (cleanCmds.length === 0) {
    return { ok: true, ran: [], exitCode: 0, output: '' };
  }

  const runnerJs = `
const zlib=require('zlib'),{spawnSync}=require('child_process');
const S='===AP'+'_CMD_START===',E='===AP'+'_CMD_END===';
const cmds=${JSON.stringify(cleanCmds)};
const logs=[];let lastCode=0;
for(const c of cmds){
  const r=spawnSync('sh',['-c',c],{encoding:'utf8',timeout:35000,env:{...process.env,CI:'true'}});
  const out=((r.stdout||'')+'\\n'+(r.stderr||'')).trim();
  logs.push('$ '+c+' (exit='+(r.status??1)+')\\n'+out.slice(-800));
  if((r.status??1)!==0){lastCode=r.status??1;}
}
const full=logs.join('\\n');
let lim=4000,gz='';
while(lim>=600){gz=zlib.gzipSync(Buffer.from(JSON.stringify({exitCode:lastCode,ran:cmds,output:full.slice(-lim)}))).toString('base64');if(gz.length<=1650)break;lim=Math.floor(lim*0.65);}
console.log('\\n'+S+'\\nGZ:'+gz+'\\n'+E);
`.trim();

  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(runnerJs).toString('base64') : btoa(unescape(encodeURIComponent(runnerJs)));
  const cap = await runTerminalCommandWithCapture(tabId, {
    bashCmd: `echo "${b64}" | base64 -d | node`,
    startMarker: '===AP_CMD_START===',
    endMarker: '===AP_CMD_END===',
    timeoutMs: 42000
  });

  if (cap.ok) {
    const decoded = await decodeTerminalJsonPayload(cap.raw);
    if (decoded) {
      return { ok: decoded.exitCode === 0, ran: decoded.ran || cleanCmds, exitCode: decoded.exitCode || 0, output: decoded.output || '' };
    }
  }

  if (cap.unreadable) {
    const chained = cleanCmds.map(c => `(${c} || true)`).join(' && ') + ' && (rm -f .git/index.lock 2>/dev/null; git add -A && git commit -m "solution" 2>/dev/null || true)';
    const disp = await dispatchCommandToTerminal(tabId, chained, 2500);
    return { ok: !!disp?.ok, ran: cleanCmds, exitCode: disp?.ok ? 0 : 1, output: '', fallbackDispatched: true };
  }

  return { ok: false, ran: cleanCmds, exitCode: 1, output: cap.error || 'Command runner failed' };
}

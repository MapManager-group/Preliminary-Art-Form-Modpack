import {nativeWorkspace} from '../tests/pakku-fixture.mjs';
// Real Pakku integration. All writes are in our own temporary template/launcher fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {run,requireSuccess,sha256} from './lib/pakku.mjs';
import {filesUnder} from './lib/workspace.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=await fs.mkdtemp(path.join(os.tmpdir(),'DB Phase3 中文 空格-')),root=path.join(base,'template');
await fs.mkdir(root);
for(const file of ['tools','toolchain.json','package.json'])await fs.cp(path.join(repo,file),path.join(root,file),{recursive:true});
await fs.cp(await fs.realpath(path.join(repo,'node_modules/fflate')),path.join(root,'node_modules/fflate'),{recursive:true});
await fs.mkdir(path.join(root,'.cache'));await fs.copyFile(path.join(repo,'.cache/pakku-1.5.0.jar'),path.join(root,'.cache/pakku-1.5.0.jar'));
await nativeWorkspace(root);
const snap=async dir=>Object.fromEntries(await Promise.all((await filesUnder(dir)).map(async n=>[n,sha256(await fs.readFile(path.join(dir,n)))])));
const cli=async(...args)=>requireSuccess(await run(process.execPath,[path.join(root,'tools/mp.mjs'),...args],{cwd:root,capture:true}));
const json=async(...args)=>JSON.parse((await cli(...args)).stdout);
const target='fabric-1.21.1',source=path.join(root,'packs',target),beforeSource=await snap(path.join(repo,'tests/fixtures'));
try {
  for(const launcher of ['pcl2','hmcl']) {
    const launcherRoot=path.join(base,launcher);await fs.cp(path.join(repo,'tests/fixtures',`launcher-${launcher}`),launcherRoot,{recursive:true});
    const game=path.join(launcherRoot,'versions/Example');
    await cli('bind',launcher,'--launcher',launcher,'--target',target,'--game-dir',game,'--confirm-game-dir');
    await cli('dev',launcher,'--stopped');
    await fs.writeFile(path.join(game,'config/db-client.json'),JSON.stringify({phase3:launcher}));
    const before=await snap(base),report=await json('changes',launcher,'--json');
    assert.equal(report.managed.find(f=>f.path==='config/db-client.json').state,'runtime-only');
    await cli('collect',launcher);await cli('status');assert.deepEqual(await snap(base),before);
    await cli('collect',launcher,'--file','config/db-client.json','--confirm','--stopped');
    assert.equal(JSON.parse(await fs.readFile(path.join(source,'.pakku/client-overrides/config/db-client.json'))).phase3,launcher);
    await cli('dev',launcher,'--stopped');
    assert.ok((await json('changes',launcher,'--json')).managed.every(f=>f.state==='unchanged'));
  }
  // Start from the FULL server+client source. Native Pakku generates every lock record.
  await cli('pakku','--target',target,'--','--yes','add','servercore');
  const lockBefore=JSON.parse(await fs.readFile(path.join(source,'pakku-lock.json')));
  assert.ok(lockBefore.projects.some(p=>Object.values(p.slug).includes('servercore')),'必须有真实服务器专用依赖');
  const result=await cli('deps-review','hmcl','--operation','add','--project','sodium');
  // review prints a human report, followed by one JSON object starting with schema.
  const candidate=JSON.parse(result.stdout.slice(result.stdout.indexOf('{\n  "schema"')));
  const candidateDir=path.join(root,candidate.projectPath),candidateLock=JSON.parse(await fs.readFile(path.join(candidateDir,'pakku-lock.json')));
  assert.ok(candidateLock.projects.some(p=>Object.values(p.slug).includes('servercore')));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(source,'pakku-lock.json'))),lockBefore);
  const bad=await run(process.execPath,[path.join(root,'tools/mp.mjs'),'deps-accept','hmcl','--candidate',candidate.id,'--accept-hash','0'.repeat(64),'--confirm'],{cwd:root,capture:true});assert.notEqual(bad.code,0);
  await cli('deps-accept','hmcl','--candidate',candidate.id,'--accept-hash',candidate.hash,'--confirm');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(source,'pakku-lock.json'))),candidateLock);
  await cli('dev','hmcl','--stopped');
  const game=path.join(base,'hmcl/versions/Example'),mods=await fs.readdir(path.join(game,'mods'));
  assert.ok(!mods.some(n=>n.toLowerCase().includes('servercore')),'服务器专用依赖不能进入客户端');
  const sodium=mods.find(n=>n.toLowerCase().includes('sodium'));assert.ok(sodium);
  await fs.rename(path.join(game,'mods',sodium),path.join(game,'mods',sodium+'.disabled'));
  await fs.writeFile(path.join(game,'mods/unknown.jar'),'fixture-only unknown, never execute');
  const drift=await json('changes','hmcl','--json');assert.ok(drift.dependencies.some(d=>d.state==='disabled'));assert.ok(drift.dependencies.some(d=>d.resolution==='unresolved'));
  await cli('restore-deps','hmcl','--file','mods/'+sodium+'.disabled','--confirm','--stopped');
  assert.ok(await fs.stat(path.join(game,'mods',sodium)));assert.equal(await fs.readFile(path.join(game,'mods/unknown.jar'),'utf8'),'fixture-only unknown, never execute');
  const removedResult=await cli('deps-review','hmcl','--operation','remove','--project','sodium');
  const removed=JSON.parse(removedResult.stdout.slice(removedResult.stdout.indexOf('{\n  "schema"')));
  const afterRemove=JSON.parse(await fs.readFile(path.join(root,removed.projectPath,'pakku-lock.json')));
  assert.ok(afterRemove.projects.some(p=>Object.values(p.slug).includes('servercore')));
  assert.ok(!afterRemove.projects.some(p=>Object.values(p.slug).includes('sodium')));
  // A changed formal source invalidates candidate acceptance.
  await fs.writeFile(path.join(source,'config/db-example.json'),'{}');
  const stale=await run(process.execPath,[path.join(root,'tools/mp.mjs'),'deps-accept','hmcl','--candidate',removed.id,'--accept-hash',removed.hash,'--confirm'],{cwd:root,capture:true});assert.notEqual(stale.code,0);
  assert.ok(!(await filesUnder(source)).some(n=>n.endsWith('.jar')));
  assert.deepEqual(await snap(path.join(repo,'tests/fixtures')),beforeSource);
  console.log('PASS: Phase 3 真实 Pakku/CLI；双启动器假实例 dev→changes→collect→deploy；ServerCore/Sodium 完整候选增删、哈希确认、过期拒绝、服务端保留、禁用/未知 JAR 分类和备份恢复；启动器夹具未改变');
  console.log(`证据保留: ${base}`);
}catch(e){console.error(`失败证据保留: ${base}`);throw e;}

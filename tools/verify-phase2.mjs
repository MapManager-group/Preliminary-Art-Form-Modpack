import {nativeWorkspace} from '../tests/pakku-fixture.mjs';
// Real Pakku + CLI integration against disposable launcher fixtures, never a personal game directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { run, requireSuccess, sha256 } from './lib/pakku.mjs';
import { filesUnder } from './lib/workspace.mjs';
import { atomicJson } from './lib/runtime-fs.mjs';
import { prepare } from './lib/prepare.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=await fs.mkdtemp(path.join(os.tmpdir(),'DB Phase2 中文 空格-'));
const root=path.join(base,'template');
await fs.mkdir(root);
for(const file of ['tools','toolchain.json','package.json'])await fs.cp(path.join(repo,file),path.join(root,file),{recursive:true});
// Only fflate is a runtime dependency; copy its real package without a junction.
await fs.cp(await fs.realpath(path.join(repo,'node_modules/fflate')),path.join(root,'node_modules/fflate'),{recursive:true});
await fs.mkdir(path.join(root,'.cache'));
await fs.copyFile(path.join(repo,'.cache/pakku-1.5.0.jar'),path.join(root,'.cache/pakku-1.5.0.jar'));
await nativeWorkspace(root);
const cli=async(...args)=>requireSuccess(await run(process.execPath,[path.join(root,'tools/mp.mjs'),...args],{cwd:root,capture:true}));
const snap=async dir=>Object.fromEntries(await Promise.all((await filesUnder(dir)).map(async f=>[f,sha256(await fs.readFile(path.join(dir,f)))])));
const beforeSource=await snap(path.join(repo,'tests/fixtures'));
try {
  for(const launcher of ['pcl2','hmcl']) {
    const launcherRoot=path.join(base,launcher);
    await fs.cp(path.join(repo,'tests/fixtures',`launcher-${launcher}`),launcherRoot,{recursive:true});
    const game=path.join(launcherRoot,'versions','Example');
    for(const [file,text] of Object.entries({'options.txt':'personal','saves/world/data':'world','logs/latest.log':'log','launcher_accounts.json':'fake-fixture-account'})) {
      await fs.mkdir(path.dirname(path.join(game,file)),{recursive:true});await fs.writeFile(path.join(game,file),text);
    }
    const preserved=await snap(game);
    await cli('bind',launcher,'--launcher',launcher,'--target','fabric-1.21.1','--game-dir',game,'--confirm-game-dir');
    await cli('prepare','--target','fabric-1.21.1');
    const readOnly=await snap(base);
    await cli('deploy',launcher,'--dry-run');
    assert.deepEqual(await snap(base),readOnly);
    await cli('deploy',launcher,'--stopped');
    const config=path.join(game,'config/db-example.json');
    const mtime=(await fs.stat(config)).mtimeMs;
    await cli('deploy',launcher,'--stopped');assert.equal((await fs.stat(config)).mtimeMs,mtime);
    await fs.writeFile(path.join(root,'packs/fabric-1.21.1/config/db-example.json'),JSON.stringify({phase2:launcher}));
    await cli('deploy',launcher,'--stopped');
    assert.equal(JSON.parse(await fs.readFile(config)).phase2,launcher);
    const after=await snap(game);for(const [file,hash] of Object.entries(preserved))assert.equal(after[file],hash);
    assert.ok(!after['config/db-server.json']);
    await fs.writeFile(config,'local conflict');
    const failure=await run(process.execPath,[path.join(root,'tools/mp.mjs'),'deploy',launcher,'--stopped'],{capture:true});
    assert.notEqual(failure.code,0);assert.equal(await fs.readFile(config,'utf8'),'local conflict');
    await cli('unbind',launcher);assert.equal(await fs.readFile(config,'utf8'),'local conflict');
  }
  // Verify real Pakku precedence, not a second implementation of its package rules.
  const client=path.join(root,'packs/fabric-1.21.1/.pakku/client-overrides/config/db-example.json');
  await fs.writeFile(client,'{"clientWins":true}');
  const target={id:'fabric-1.21.1',path:'packs/fabric-1.21.1',artifacts:['modrinth','serverpack']};
  const prepared=await prepare(root,target);
  const selected=prepared.files.find(f=>f.path==='config/db-example.json');
  assert.equal(selected.source,'.pakku/client-overrides/config/db-example.json');
  assert.equal(selected.hash,sha256(Buffer.from('{"clientWins":true}')));
  // Exercise native dependency resolution and real HTTPS/hash-verified download into a fake instance.
  await cli('pakku','--target','fabric-1.21.1','--','--yes','add','sodium');
  const dependencyRoot=path.join(base,'dependency-launcher');
  await fs.cp(path.join(repo,'tests/fixtures/launcher-pcl2'),dependencyRoot,{recursive:true});
  const dependencyGame=path.join(dependencyRoot,'versions/Example');
  await cli('bind','dependency','--launcher','pcl2','--target','fabric-1.21.1','--game-dir',dependencyGame,'--confirm-game-dir');
  const dependencies=await prepare(root,target);
  assert.ok(dependencies.files.some(f=>f.kind==='dependency'),'真实 Pakku add 必须产生依赖');
  await cli('deploy','dependency','--stopped');
  const mods=await fs.readdir(path.join(dependencyGame,'mods'));
  assert.ok(mods.some(f=>f.toLowerCase().includes('sodium')&&f.endsWith('.jar')));
  await cli('deploy','dependency','--stopped');
  await cli('unbind','dependency');
  assert.deepEqual(await snap(path.join(repo,'tests/fixtures')),beforeSource);
  console.log('PASS: 真实 Pakku + CLI，PCL/HMCL 假实例绑定/只读预览/重复部署/单文件更新/冲突/解绑/覆盖优先级、Sodium 下载部署；启动器夹具未改变');
  console.log(`验证副本与假实例保留于: ${base}`);
}catch(e){console.error(`失败证据保留于: ${base}`);throw e;}

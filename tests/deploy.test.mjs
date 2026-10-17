import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {scanImportDependencies} from '../tools/lib/import-dependencies.mjs';
import { inspectLauncher } from '../tools/lib/launcher.mjs';
import { bindRuntime, runtimes, unbindRuntime } from '../tools/lib/runtimes.mjs';
import { clientManifest, digest, obtainBytes } from '../tools/lib/prepare.mjs';
import { deploy, recover } from '../tools/lib/deploy.mjs';
import { atomicJson, localPath, lockOperation, managedPath } from '../tools/lib/runtime-fs.mjs';
import { classifyProcesses } from '../tools/lib/processes.mjs';

import {setup,stopped,save,snapshot} from './sync-fixture.mjs';

test('PCL/HMCL 隔离、公共根拒绝、自定义目录与版本不符',async t=>{
  for(const launcher of ['pcl2','hmcl']) {
    const f=await setup(t,launcher);
    assert.equal((await inspectLauncher(f.runtime)).layout,'isolated');
    if(launcher==='pcl2')await save(path.join(f.gameDir,'PCL/Setup.ini'),'VersionArgumentIndieV2:False\n');
    else await atomicJson(path.join(f.gameDir,'hmclversion.cfg'),{usesGlobal:false,gameDirType:0});
    await assert.rejects(inspectLauncher({...f.runtime,gameDir:f.mcRoot}),/公共/);
    if(launcher==='hmcl') {
      const custom=path.join(f.base,'自定义 gameDir');await fs.mkdir(custom);
      await atomicJson(path.join(f.gameDir,'hmclversion.cfg'),{usesGlobal:false,gameDirType:2,gameDir:custom});
      assert.equal((await inspectLauncher({...f.runtime,gameDir:custom})).layout,'custom');
      await bindRuntime(f.root,f.target,'custom',{launcher,gameDir:custom,versionDir:f.gameDir,confirmGameDir:true});
    }
    await assert.rejects(bindRuntime(f.root,f.target,'bad',{launcher,gameDir:f.root,confirmGameDir:true}),/工作区/);
  }
});
test('绑定 dry-run 无写入、未知布局明确确认、版本不匹配拒绝',async t=>{
  const f=await setup(t);
  await fs.rm(path.join(f.gameDir,'PCL/Setup.ini'));
  const before=await snapshot(f.base);
  const report=await bindRuntime(f.root,f.target,'preview',{launcher:'pcl2',gameDir:f.gameDir,dryRun:true});
  assert.equal(report.runtime.layout,'explicit');assert.deepEqual(await snapshot(f.base),before);
  await assert.rejects(bindRuntime(f.root,f.target,'preview',{launcher:'pcl2',gameDir:f.gameDir}),/confirm-game-dir/);
  await atomicJson(path.join(f.gameDir,'Example.json'),{id:'Example',inheritsFrom:'1.20.1',libraries:[]});
  await assert.rejects(bindRuntime(f.root,f.target,'bad',{launcher:'pcl2',gameDir:f.gameDir,confirmGameDir:true}),/版本/);
});
test('同路径别名共享基线与互斥锁，unbind 不删除数据',async t=>{
  const f=await setup(t);await f.stage();
  const alias=(await bindRuntime(f.root,f.target,'alias',{launcher:'hmcl',gameDir:f.gameDir,confirmGameDir:true})).runtime;
  assert.equal(alias.key,f.runtime.key);
  await lockOperation(f.runtime.key,()=>assert.rejects(deploy(f.root,alias,f.target,stopped),/锁定/));
  await deploy(f.root,f.runtime,f.target,stopped);
  const before=await snapshot(f.gameDir);
  await unbindRuntime(f.root,'dev');
  assert.equal((await runtimes(f.root)).bindings.length,1);
  assert.deepEqual(await snapshot(f.gameDir),before);
  assert.deepEqual(await deploy(f.root,alias,f.target,stopped),{unchanged:true});
});
test('增删改、重复部署不重写，保留私人/未知文件与客户端侧别',async t=>{
  const f=await setup(t);await f.stage();
  for(const name of ['saves/world/data','logs/latest.log','options.txt','launcher_accounts.json','mods/unknown.jar','config/private.txt'])await save(path.join(f.gameDir,name),'PRIVATE '+name);
  const privateBefore=await snapshot(f.gameDir);
  const beforeDry=await snapshot(f.base);
  await deploy(f.root,f.runtime,f.target,{...stopped,dryRun:true});assert.deepEqual(await snapshot(f.base),beforeDry);
  await deploy(f.root,f.runtime,f.target,stopped);
  assert.equal((await fs.readFile(path.join(f.gameDir,'config/db-client.json'),'utf8')).trim(),'{"templateClient":true}');
  await assert.rejects(fs.access(path.join(f.gameDir,'config/db-server.json')));
  const stable=await fs.stat(path.join(f.gameDir,'config/db-client.json'));
  assert.deepEqual(await deploy(f.root,f.runtime,f.target,stopped),{unchanged:true});
  await f.change('{"changed":true}\n');await f.stage();await deploy(f.root,f.runtime,f.target,stopped);
  assert.equal((await fs.stat(path.join(f.gameDir,'config/db-client.json'))).mtimeMs,stable.mtimeMs);
  await fs.rm(path.join(f.root,f.target.path,'.pakku/overrides/template-common.txt'));
  await f.stage();await deploy(f.root,f.runtime,f.target,stopped);
  await assert.rejects(fs.access(path.join(f.gameDir,'template-common.txt')));
  const after=await snapshot(f.gameDir);for(const [name,hash] of Object.entries(privateBefore))assert.equal(after[name],hash);
});
test('初次同名文件不自动接管，仅允许明确接管相同内容',async t=>{
  const f=await setup(t);await f.stage();
  await save(path.join(f.gameDir,'config/db-example.json'),await fs.readFile(path.join(f.root,f.target.path,'config/db-example.json')));
  const before=await snapshot(f.gameDir);
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/冲突/);
  assert.deepEqual(await snapshot(f.gameDir),before);
  await deploy(f.root,f.runtime,f.target,{...stopped,adoptExisting:true});
});
test('源与实例冲突、实例删除、源删除且实例修改均阻止整批覆盖',async t=>{
  const f=await setup(t);await f.stage();await deploy(f.root,f.runtime,f.target,stopped);
  await save(path.join(f.gameDir,'config/db-example.json'),'local');await f.change('source');await f.stage();
  const before=await snapshot(f.gameDir);
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/冲突/);assert.deepEqual(await snapshot(f.gameDir),before);
  await fs.rm(path.join(f.gameDir,'config/db-example.json'));
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/冲突/);
  await save(path.join(f.gameDir,'template-common.txt'),'local change');
  await fs.rm(path.join(f.root,f.target.path,'.pakku/overrides/template-common.txt'));await f.stage();
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/冲突/);
});
test('写入中断保留 journal、阻止下一次部署、可恢复且恢复幂等',async t=>{
  const f=await setup(t);await f.stage();await deploy(f.root,f.runtime,f.target,stopped);
  const before=await snapshot(f.gameDir),baseline=await fs.readFile(await localPath(f.root,`runtimes/${f.runtime.key}/baseline.json`),'utf8');
  await f.change('updated');await save(path.join(f.root,f.target.path,'client-note.txt'),'client updated');await f.stage();
  await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,beforeWrite:(_c,i)=>{if(i===1)throw Error('injected write failure');}}),/recover/);
  assert.equal(await fs.readFile(await localPath(f.root,`runtimes/${f.runtime.key}/baseline.json`),'utf8'),baseline);
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/未完成/);
  // Simulate a crash after rename but before the completed marker reached disk.
  const jf=await localPath(f.root,`runtimes/${f.runtime.key}/journal.json`);
  const journal=JSON.parse(await fs.readFile(jf,'utf8'));journal.completed=[];await atomicJson(jf,journal);
  await recover(f.root,f.runtime,stopped);assert.deepEqual(await snapshot(f.gameDir),before);
  assert.deepEqual(await recover(f.root,f.runtime,stopped),{recovery:'无需恢复'});
});
test('恢复遇到新本地修改不覆盖',async t=>{
  const f=await setup(t);await f.stage();
  await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,beforeWrite:(_c,i)=>{if(i===1)throw Error('interrupt');}}));
  await save(path.join(f.gameDir,'client-note.txt'),'newer local edit');
  await assert.rejects(recover(f.root,f.runtime,stopped),/恢复冲突/);
  assert.equal(await fs.readFile(path.join(f.gameDir,'client-note.txt'),'utf8'),'newer local edit');
});
test('备份损坏时恢复在预检阶段拒绝所有写入',async t=>{
  const f=await setup(t);await f.stage();await deploy(f.root,f.runtime,f.target,stopped);
  await f.change('new');await save(path.join(f.root,f.target.path,'client-note.txt'),'new client');await f.stage();
  await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,beforeWrite:(_c,i)=>{if(i===1)throw Error('interrupt');}}));
  const journal=JSON.parse(await fs.readFile(await localPath(f.root,`runtimes/${f.runtime.key}/journal.json`),'utf8'));
  await fs.writeFile(await localPath(f.root,`runtimes/${f.runtime.key}/transactions/${journal.id}/${journal.changes[0].before}`),'corrupt');
  const before=await snapshot(f.gameDir);await assert.rejects(recover(f.root,f.runtime,stopped),/备份损坏/);assert.deepEqual(await snapshot(f.gameDir),before);
});
test('准备后源变化与未停止游戏不会写 Runtime',async t=>{
  const f=await setup(t);await f.stage();
  await assert.rejects(deploy(f.root,f.runtime,f.target,{probe:stopped.probe}),/test fixture/);
  await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,probe:async()=>({status:'running'})}),/正在运行/);
  const before=await snapshot(f.gameDir);await f.change('new source');
  await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,dryRun:true}),/prepare/);
  assert.deepEqual(await snapshot(f.gameDir),before);
});
test('junction 越界、硬链接、只读文件和受保护路径均拒绝',async t=>{
  const f=await setup(t);await f.stage();
  const outside=path.join(f.base,'outside');await fs.mkdir(outside);
  await fs.symlink(outside,path.join(f.gameDir,'config'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/junction/);
  await fs.unlink(path.join(f.gameDir,'config'));
  await deploy(f.root,f.runtime,f.target,stopped);
  await fs.chmod(path.join(f.gameDir,'config/db-example.json'),0o444);
  t.after(()=>fs.chmod(path.join(f.gameDir,'config/db-example.json'),0o644).catch(()=>{}));
  await f.change('new');await f.stage();await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/冲突/);
  await fs.chmod(path.join(f.gameDir,'config/db-example.json'),0o644);
  await fs.link(path.join(f.gameDir,'client-note.txt'),path.join(outside,'hardlink'));
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/独立文件/);
  for(const name of ['../escape','saves/world/data','PCL/Setup.ini','hmclversion.cfg','config/CON','config/x:stream'])assert.throws(()=>managedPath(name));
});
test('依赖缓存校验/下载失败不会写 Runtime，服务端依赖不进入客户端',async t=>{
  const f=await setup(t);const bytes=Buffer.from('safe fake jar bytes, never executed');
  const dependency={path:'mods/demo.jar',hashes:{sha512:digest(bytes,'sha512'),sha1:digest(bytes,'sha1')},downloads:['https://example.invalid/demo.jar'],fileSize:bytes.length,env:{client:'required',server:'required'}};
  const server={...dependency,path:'mods/server.jar',env:{client:'unsupported',server:'required'}};
  const prepared=await f.stage([dependency,server]);
  assert.ok(!prepared.files.some(f=>f.path==='mods/server.jar'));
  const before=await snapshot(f.gameDir);
  await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,download:async()=>new Response('bad')}),/下载失败/);
  assert.deepEqual(await snapshot(f.gameDir),before);
  let count=0;const download=async()=>{count++;return new Response(bytes);};
  await deploy(f.root,f.runtime,f.target,{...stopped,download});assert.equal(count,1);
  assert.deepEqual(await deploy(f.root,f.runtime,f.target,{...stopped,download}),{unchanged:true});assert.equal(count,1);
  const item=prepared.files.find(f=>f.kind==='dependency');
  await fs.writeFile(path.join(f.root,'.cache/dependencies',item.hash),'corrupt');
  await assert.rejects(obtainBytes(f.root,prepared,item,download),/缓存损坏/);
});
test('下载过程中源发生变化时，在任何 Runtime 写入前中止',async t=>{
  const f=await setup(t),bytes=Buffer.from('fixture dependency');
  await f.stage([{path:'mods/demo.jar',hashes:{sha512:digest(bytes,'sha512'),sha1:digest(bytes,'sha1')},downloads:['https://example.invalid/demo'],fileSize:bytes.length}]);
  const before=await snapshot(f.gameDir);
  await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,download:async()=>{await f.change('concurrent edit');return new Response(bytes);}}),/源已变化/);
  assert.deepEqual(await snapshot(f.gameDir),before);
});
test('MRPACK common < client 优先级与来源映射、路径穿越拒绝',()=>{
  const entries={'modrinth.index.json':Buffer.from(JSON.stringify({files:[],dependencies:{minecraft:'1.21.1'}})),'overrides/config/demo.txt':Buffer.from('common'),'client-overrides/config/demo.txt':Buffer.from('client'),'server-overrides/config/secret.txt':Buffer.from('server')};
  const info={mapping:[{archivePath:'client-overrides/config/demo.txt',source:'.pakku/client-overrides/config/demo.txt'}],hashes:{'.pakku/client-overrides/config/demo.txt':digest(Buffer.from('client'))}};
  const result=clientManifest(entries,info);assert.equal(result.files.length,1);assert.equal(result.files[0].hash,digest(Buffer.from('client')));assert.equal(result.files[0].source,'.pakku/client-overrides/config/demo.txt');
  entries['client-overrides/../escape']=Buffer.from('bad');assert.throws(()=>clientManifest(entries,info));
});
test('进程匹配：已检测游戏不可绕过，未知 Java 不伪装精确检测',()=>{
  assert.equal(classifyProcesses([{name:'javaw.exe',command:'net.minecraft.client.main.Main'}],'D:/game').status,'running');
  assert.equal(classifyProcesses([{name:'java.exe',command:null}],'D:/game').status,'unknown');
  assert.equal(classifyProcesses([],'D:/game').status,'not-observed');
});
test('Windows 实际 FileShare.Read 锁定文件导致部署失败并可恢复',{skip:process.platform!=='win32'},async t=>{
  const f=await setup(t);await f.stage();await deploy(f.root,f.runtime,f.target,stopped);await f.change('new');await f.stage();
  const script=path.join(f.base,'hold.ps1');
  await fs.writeFile(script,'param([string]$Target)\n$f=[IO.File]::Open($Target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)\nWrite-Output "LOCKED"\n[Console]::ReadLine() | Out-Null\n$f.Dispose()\n');
  const child=spawn('pwsh',['-NoProfile','-File',script,'-Target',path.join(f.gameDir,'config/db-example.json')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(d.toString().includes('LOCKED'))resolve();});child.on('error',reject);child.on('exit',code=>reject(Error(`lock helper exited ${code}`)));});
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped));
  child.stdin.end('\n');await once(child,'exit');
  await recover(f.root,f.runtime,stopped);
});

async function missingModsFixture(t) {
  const f=await setup(t);
  const bytes=Array.from({length:5},(_,i)=>Buffer.from(`fake managed mod ${i}, never executed`));
  const dependencies=bytes.map((data,i)=>({path:`mods/mod-${i}.jar`,hashes:{sha512:digest(data,'sha512'),sha1:digest(data,'sha1')},downloads:[`https://example.invalid/mod-${i}`],fileSize:data.length}));
  const download=async url=>new Response(bytes[Number(url.split('-').at(-1))]);
  await f.stage(dependencies);await deploy(f.root,f.runtime,f.target,{...stopped,download});
  const baselineFile=await localPath(f.root,`runtimes/${f.runtime.key}/baseline.json`);
  const remove=async()=>{for(const dep of dependencies)await fs.unlink(path.join(f.gameDir,dep.path));};
  return {...f,bytes,dependencies,download,baselineFile,remove};
}

test('删除五个受管 Mod 后整批恢复，缓存与重新下载均校验，配置和未知文件保留',async t=>{
  const f=await missingModsFixture(t);
  for(const name of ['mods/private.jar','config/private.json','saves/world/data','options.txt'])await save(path.join(f.gameDir,name),'private');
  const before=await snapshot(f.gameDir);
  await f.remove();
  // Keep three cache entries, redownload two.
  for(const dep of f.dependencies.slice(0,2))await fs.unlink(path.join(f.root,'.cache/dependencies',dep.hashes.sha512));
  const absent=await snapshot(f.base);
  const plan=await deploy(f.root,f.runtime,f.target,{...stopped,dryRun:true});
  assert.equal(plan.conflicts.length,0);assert.equal(plan.actions.length,5);assert.equal(plan.downloads.length,2);
  assert.ok(plan.actions.every(a=>a.type==='add'&&a.before===null&&a.reason==='受管依赖缺失，待恢复'));
  assert.deepEqual(await snapshot(f.base),absent);
  const downloaded=[];
  const result=await deploy(f.root,f.runtime,f.target,{...stopped,download:async url=>{downloaded.push(url);return f.download(url);}});
  assert.equal(result.applied,5);assert.equal(downloaded.length,2);
  assert.deepEqual(await snapshot(f.gameDir),before);
  const baseline=JSON.parse(await fs.readFile(f.baselineFile,'utf8'));
  for(const dep of f.dependencies) {
    const bytes=await fs.readFile(path.join(f.gameDir,dep.path));
    assert.equal(digest(bytes,'sha512'),dep.hashes.sha512);assert.equal(digest(bytes,'sha1'),dep.hashes.sha1);
    assert.equal(baseline.files.find(item=>item.path===dep.path).hash,dep.hashes.sha512);
  }
  assert.deepEqual(await deploy(f.root,f.runtime,f.target,stopped),{unchanged:true});
});

test('缺失 Mod 可恢复但修改 JAR、修改或删除配置仍阻止整批写入',async t=>{
  for(const kind of ['jar','config-edit','config-delete']) {
    const f=await missingModsFixture(t);await fs.unlink(path.join(f.gameDir,f.dependencies[0].path));
    if(kind==='jar')await save(path.join(f.gameDir,f.dependencies[1].path),'modified jar');
    if(kind==='config-edit')await save(path.join(f.gameDir,'config/db-example.json'),'modified config');
    if(kind==='config-delete')await fs.unlink(path.join(f.gameDir,'config/db-example.json'));
    const before=await snapshot(f.base);
    await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/冲突/);
    assert.deepEqual(await snapshot(f.base),before);
  }
});

test('缺失依赖缓存损坏或下载校验失败时，不写 Runtime 或提前提交 baseline',async t=>{
  for(const failure of ['cache','download']) {
    const f=await missingModsFixture(t);await f.remove();
    await f.change('new source version');await f.stage(f.dependencies);
    const cache=path.join(f.root,'.cache/dependencies',f.dependencies[0].hashes.sha512);
    if(failure==='cache')await fs.writeFile(cache,'corrupt');else await fs.unlink(cache);
    const before=await snapshot(f.gameDir),baseline=await fs.readFile(f.baselineFile,'utf8');
    await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,download:async()=>new Response(Buffer.alloc(f.bytes[0].length))}),/缓存损坏|下载失败/);
    assert.deepEqual(await snapshot(f.gameDir),before);assert.equal(await fs.readFile(f.baselineFile,'utf8'),baseline);
  }
});

test('缺失依赖恢复中断保留旧 baseline，recover 回到部署前缺失状态后可重试',async t=>{
  const f=await missingModsFixture(t);await f.remove();
  const before=await snapshot(f.gameDir),baseline=await fs.readFile(f.baselineFile,'utf8');
  await f.change('new source version');const prepared=await f.stage(f.dependencies);
  await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,beforeWrite:(change,i)=>{if(change.path==='mods/mod-2.jar')throw Error('restore interrupted');}}),/restore interrupted/);
  assert.equal(await fs.readFile(f.baselineFile,'utf8'),baseline);
  assert.equal(digest(await fs.readFile(path.join(f.gameDir,'mods/mod-0.jar')),'sha512'),f.dependencies[0].hashes.sha512);
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/未完成/);
  await recover(f.root,f.runtime,stopped);
  assert.deepEqual(await snapshot(f.gameDir),before);assert.equal(await fs.readFile(f.baselineFile,'utf8'),baseline);
  await deploy(f.root,f.runtime,f.target,stopped);
  assert.equal(JSON.parse(await fs.readFile(f.baselineFile,'utf8')).source.fingerprint,prepared.fingerprint);
});

test('已从源清单移除的缺失 Mod 不恢复，未知文件仍保留',async t=>{
  const f=await missingModsFixture(t);await f.remove();await save(path.join(f.gameDir,'mods/unknown.jar'),'unknown');
  await f.stage([]);
  const plan=await deploy(f.root,f.runtime,f.target,{...stopped,dryRun:true});
  assert.equal(plan.actions.length,0);assert.equal(plan.conflicts.length,0);
  await deploy(f.root,f.runtime,f.target,stopped);
  assert.deepEqual(await fs.readdir(path.join(f.gameDir,'mods')),['unknown.jar']);
  assert.ok(!JSON.parse(await fs.readFile(f.baselineFile,'utf8')).files.some(item=>item.kind==='dependency'));
});

test('本地 overrides 二进制同步保持哈希，修改冲突与未知文件保护不变',async t=>{
  const f=await setup(t);
  const files={'mods/local.jar':Buffer.from([0,255,33]),'resourcepacks/local.zip':Buffer.from([80,75,0]),'shaderpacks/local.zip':Buffer.from([80,75,1]),'resourcepacks/unpacked/assets/demo/a.png':Buffer.from([0,255,3])};
  for(const [name,bytes] of Object.entries(files))await save(path.join(f.root,f.target.path,'.pakku/client-overrides',name),bytes);
  await save(path.join(f.gameDir,'mods/unknown.jar'),'untouched');
  await f.stage();await deploy(f.root,f.runtime,f.target,stopped);
  for(const [name,bytes] of Object.entries(files))assert.deepEqual(await fs.readFile(path.join(f.gameDir,name)),bytes);
  assert.equal(await fs.readFile(path.join(f.gameDir,'mods/unknown.jar'),'utf8'),'untouched');
  let scan=await scanImportDependencies(f.root,f.runtime,f.target);
  assert.ok(scan.skipped.some(item=>item.path==='mods/local.jar'));assert.ok(!scan.candidates.some(item=>item.path==='mods/local.jar'));
  await save(path.join(f.gameDir,'mods/local.jar'),'modified');
  scan=await scanImportDependencies(f.root,f.runtime,f.target);assert.ok(!scan.candidates.some(item=>item.path==='mods/local.jar'));
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/冲突/);
});

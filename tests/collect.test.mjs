import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setup,stopped,save,snapshot} from './sync-fixture.mjs';
import {changes,compareThree} from '../tools/lib/changes.mjs';
import {collect} from '../tools/lib/collect.mjs';
import {deploy,recover} from '../tools/lib/deploy.mjs';
import {restoreDependencies,acceptDependencies} from '../tools/lib/dependencies.mjs';
import {digest} from '../tools/lib/prepare.mjs';
import {status} from '../tools/lib/status.mjs';
import {lockOperation,runtimeKey} from '../tools/lib/runtime-fs.mjs';

const name='config/db-example.json',client='config/db-client.json';
const src=(f,n=name)=>path.join(f.root,f.target.path,n);
const game=(f,n=name)=>path.join(f.gameDir,n);
async function deployed(t) {const f=await setup(t);await f.stage();await deploy(f.root,f.runtime,f.target,stopped);return f;}
const report=f=>changes(f.root,f.runtime,f.target,{diff:true});
const get=(r,n=name)=>[...r.managed,...r.conflicts].find(f=>f.path===n);

test('三方真值表包含增删与双方相同删除',()=>{
  for(const [b,s,r,want] of [['b','b','b','unchanged'],['b','s','b','source-only'],['b','b','r','runtime-only'],['b','s','s','consistent'],['b','s','r','conflict'],['b',null,'r','conflict'],['b',null,null,'consistent'],['b','b',null,'runtime-only'],[null,'s',null,'source-only'],[null,'s','r','conflict']])assert.equal(compareThree(b,s,r),want);
});
test('Changes/Collect 预览完全只读，文本差异与持久 B 在 .work 丢失后可用',async t=>{
  const f=await deployed(t);await fs.rm(path.join(f.root,'.work'),{recursive:true});
  await fs.writeFile(game(f),'runtime edit');
  const before=await snapshot(f.base),r=await report(f);
  assert.equal(get(r).state,'runtime-only');assert.match(get(r).diff.text,/\+runtime edit/);assert.ok(get(r).baselineText);
  assert.equal((await collect(f.root,f.runtime,f.target)).preview,true);
  assert.deepEqual(await snapshot(f.base),before);
});
test('三方源改/相同改/不同改/源删实例改和来源重映射',async t=>{
  const f=await deployed(t);await fs.writeFile(src(f),'source edit');
  assert.equal(get(await report(f)).state,'source-only');
  await fs.writeFile(game(f),'source edit');assert.equal(get(await report(f)).state,'consistent');
  await fs.writeFile(game(f),'different');assert.equal(get(await report(f)).state,'conflict');
  const before=await snapshot(path.join(f.root,'packs'));
  await assert.rejects(collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:name}),/冲突/);
  assert.deepEqual(await snapshot(path.join(f.root,'packs')),before);
  await fs.rm(src(f,'.pakku/client-overrides/'+client));await fs.writeFile(game(f,client),'changed after source deletion');
  assert.equal(get(await report(f),client).state,'conflict');
  await save(src(f,'.pakku/client-overrides/'+name),'new client origin');
  assert.equal(get(await report(f)).state,'conflict');
});
test('选择性 Collect 保留 common/client/server 映射、备份与待部署状态，无 Git 操作',async t=>{
  const f=await deployed(t),server=await fs.readFile(src(f,'.pakku/server-overrides/config/db-server.json'));
  await fs.writeFile(game(f,client),'client collected');await fs.writeFile(game(f),'common pending');
  await assert.rejects(collect(f.root,f.runtime,f.target,{...stopped,confirm:true}),/--file/);
  const result=await collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:client});
  assert.equal(await fs.readFile(src(f,'.pakku/client-overrides/'+client),'utf8'),'client collected');
  assert.notEqual(await fs.readFile(src(f),'utf8'),'common pending');
  assert.deepEqual(await fs.readFile(src(f,'.pakku/server-overrides/config/db-server.json')),server);
  assert.ok(await fs.readFile(path.join(f.root,result.backup,'before')));
  assert.equal(get(await report(f),client).state,'consistent');
  await collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:name});
  await f.stage();await deploy(f.root,f.runtime,f.target,stopped);
  assert.equal(get(await report(f)).state,'unchanged');
});
test('实例删除需明确 --delete；重命名作为删除与候选分开审查',async t=>{
  const f=await deployed(t);await fs.rename(game(f,client),game(f,'config/renamed.json'));
  const r=await report(f);assert.equal(get(r,client).state,'runtime-only');assert.ok(r.candidates.find(f=>f.path==='config/renamed.json'));
  await assert.rejects(collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:client}),/--delete/);
  await collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:client,delete:true});
  await assert.rejects(fs.stat(src(f,'.pakku/client-overrides/'+client)),{code:'ENOENT'});
  await collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:'config/renamed.json',source:'.pakku/client-overrides/config/renamed.json'});
  await f.stage();await deploy(f.root,f.runtime,f.target,{...stopped,adoptExisting:true});
  assert.equal(get(await report(f),'config/renamed.json').state,'unchanged');
});
test('未知 config 需显式来源；私人、二进制、JAR、侧别冲突、凭据拒绝',async t=>{
  const f=await deployed(t);
  for(const [n,bytes] of [['options.txt','private'],['saves/a/data','private'],['config/new.json','{}'],['config/binary.bin',Buffer.from([0,1])],['config/a.jar','jar'],['config/token.json','{"accessToken":"secret"}'],['config/db-server.json','server collision']])await save(game(f,n),bytes);
  const r=await report(f);assert.ok(r.candidates.some(c=>c.binary));assert.ok(!r.candidates.some(c=>c.path==='options.txt'));
  await assert.rejects(collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:'config/new.json'}),/--source/);
  for(const n of ['options.txt','config/binary.bin','config/a.jar','config/token.json','config/db-server.json'])await assert.rejects(collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:n,source:'.pakku/client-overrides/'+n}));
  await collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:'config/new.json',source:'.pakku/client-overrides/config/new.json'});
  assert.equal(await fs.readFile(src(f,'.pakku/client-overrides/config/new.json'),'utf8'),'{}');
});
test('Collect 停止状态、硬链接、并发锁与写前源变化阻止覆盖',async t=>{
  const f=await deployed(t);await fs.writeFile(game(f),'edit');
  await assert.rejects(collect(f.root,f.runtime,f.target,{confirm:true,file:name}),/stopped/);
  await lockOperation(runtimeKey(path.join(f.root,f.target.path)),()=>assert.rejects(collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:name}),/锁定/));
  await assert.rejects(collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:name,beforeWrite:()=>fs.writeFile(src(f),'new developer edit')}),/源文件已变化/);
  assert.equal(await fs.readFile(src(f),'utf8'),'new developer edit');
  await fs.link(game(f),path.join(f.base,'hardlink'));
  await assert.rejects(report(f),/独立/);
});
const dep=(n,bytes,client='required')=>({path:`mods/${n}.jar`,hashes:{sha512:digest(bytes,'sha512'),sha1:digest(bytes,'sha1')},downloads:['https://example.invalid/'+n],fileSize:bytes.length,env:{client}});
async function withDeps(t) {
  const f=await setup(t),bytes=Buffer.from('not executable dependency'),deps=[dep('client',bytes),dep('server',bytes,'unsupported')];
  await f.stage(deps);await deploy(f.root,f.runtime,f.target,{...stopped,download:async()=>new Response(bytes)});
  return {...f,bytes,deps};
}
test('额外/禁用/删除/替换 JAR 分类，客户端不虚报缺少服务端依赖',async t=>{
  const f=await withDeps(t);await fs.rename(game(f,'mods/client.jar'),game(f,'mods/client.jar.disabled'));await save(game(f,'mods/unknown.jar'),'unknown');
  const r=await report(f);assert.deepEqual(r.dependencies.map(d=>d.state).sort(),['disabled','extra','missing']);
  assert.equal(r.dependencies.find(d=>d.state==='extra').resolution,'unresolved');
  assert.ok(!r.dependencies.some(d=>d.path==='mods/server.jar'));
  await save(game(f,'mods/client.jar'),'replacement');assert.equal((await report(f)).dependencies.find(d=>d.path==='mods/client.jar').state,'replaced');
});
test('Restore-deps 只读预览、修复受管依赖、显式额外文件备份，保持配置及未知 Mod',async t=>{
  const f=await withDeps(t);await fs.writeFile(game(f,'mods/client.jar'),'replacement');await save(game(f,'mods/unknown.jar'),'unknown');await save(game(f,'mods/client.jar.disabled'),f.bytes);await fs.writeFile(game(f),'keep config edit');
  const before=await snapshot(f.base);await restoreDependencies(f.root,f.runtime,f.target);assert.deepEqual(await snapshot(f.base),before);
  const result=await restoreDependencies(f.root,f.runtime,f.target,{...stopped,confirm:true,file:'mods/client.jar.disabled'});
  assert.deepEqual(await fs.readFile(game(f,'mods/client.jar')),f.bytes);assert.equal(await fs.readFile(game(f),'utf8'),'keep config edit');
  assert.equal(await fs.readFile(game(f,'mods/unknown.jar'),'utf8'),'unknown');
  assert.equal(await fs.readFile(path.join(f.root,result.backup,digest(Buffer.from('replacement'))),'utf8'),'replacement');
  await assert.rejects(fs.stat(game(f,'mods/server.jar')),{code:'ENOENT'});
  assert.ok(!(await snapshot(path.join(f.root,'packs')))['example/mods/client.jar']);
});
test('Restore-deps 中断使用已有 recover；拒绝新修改覆盖',async t=>{
  const f=await withDeps(t);await fs.writeFile(game(f,'mods/client.jar'),'replacement');await save(game(f,'mods/extra.jar'),'extra');
  await assert.rejects(restoreDependencies(f.root,f.runtime,f.target,{...stopped,confirm:true,file:'mods/extra.jar',beforeWrite:(_c,i)=>{if(i===1)throw new Error('injected');}}),/recover/);
  await recover(f.root,f.runtime,stopped);assert.equal(await fs.readFile(game(f,'mods/client.jar'),'utf8'),'replacement');
  assert.equal(await fs.readFile(game(f,'mods/extra.jar'),'utf8'),'extra');
});
test('Status 只读输出待回收、部署来源，不输出完整系统路径',async t=>{
  const f=await deployed(t);await fs.writeFile(game(f),'edit');const before=await snapshot(f.base);
  const s=await status(f.root,{targets:[f.target]});assert.equal(s.selected,'example');assert.ok(s.runtimes[0].pendingCollect.includes(name));
  assert.ok(!JSON.stringify(s).includes(f.gameDir));assert.deepEqual(await snapshot(f.base),before);
  await assert.rejects(acceptDependencies(f.root,f.target,{confirm:true}),/accept-hash/);
});


test('轻量 Status 只读本地元数据，游戏目录离线时也不扫描或报告虚假的零变更',async t=>{
  const f=await deployed(t);
  await fs.rename(f.gameDir,f.gameDir+'-offline');
  const before=await snapshot(f.base),workspace={targets:[f.target]};
  const light=await status(f.root,workspace,{light:true});
  assert.equal(light.light,true);assert.equal(light.selected,f.target.id);
  assert.equal(light.bindings[0].id,f.runtime.id);assert.equal(light.targets[0].id,f.target.id);
  assert.equal(light.runtimes[0].deployed,true);assert.equal(light.runtimes[0].sourceKind,'local');
  assert.equal(light.runtimes[0].version,'0.1.0');assert.equal(light.runtimes[0].error,undefined);
  assert.equal(light.runtimes[0].pendingCollect,undefined);assert.equal(light.runtimes[0].conflicts,undefined);
  assert.ok(!JSON.stringify(light).includes(f.gameDir));
  assert.match((await status(f.root,workspace)).runtimes[0].error,/检查失败/);
  assert.deepEqual(await snapshot(f.base),before);
});

test('明确纳管 options 和根目录配置可同步回收；未知设置、冲突和恢复仍受保护',async t=>{
  const f=await setup(t),options='options.txt',origin='.pakku/client-overrides/options.txt';
  await save(src(f,origin),'fov:80\n');await save(src(f,'.pakku/client-overrides/custom-settings.json'),'{}');
  await save(game(f,options),'fov:90\n');await f.stage();
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/冲突/);
  assert.equal(await fs.readFile(game(f,options),'utf8'),'fov:90\n');
  await fs.unlink(game(f,options));
  await deploy(f.root,f.runtime,f.target,stopped);
  await fs.writeFile(game(f,options),'fov:95\n');
  assert.equal(get(await report(f),options).state,'runtime-only');
  await assert.rejects(deploy(f.root,f.runtime,f.target,stopped),/冲突/);
  await collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:options});
  assert.equal(await fs.readFile(src(f,origin),'utf8'),'fov:95\n');
  await f.stage();await deploy(f.root,f.runtime,f.target,stopped);
  await fs.writeFile(src(f,origin),'fov:100\n');await f.stage();
  await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,beforeWrite:change=>{if(change.path===options)throw Error('options interruption');}}),/recover/);
  await recover(f.root,f.runtime,stopped);
  assert.equal(await fs.readFile(game(f,options),'utf8'),'fov:95\n');
  await save(game(f,'optionsof.txt'),'personal');
  assert.ok(!(await report(f)).candidates.some(item=>item.path==='optionsof.txt'));
  await assert.rejects(collect(f.root,f.runtime,f.target,{...stopped,confirm:true,file:'optionsof.txt',source:'.pakku/client-overrides/optionsof.txt'}),/不可回收/);
});

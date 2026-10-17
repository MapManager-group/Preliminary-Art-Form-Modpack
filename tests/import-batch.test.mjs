import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setup,save,snapshot} from './sync-fixture.mjs';
import {scanImportDependencies,importDependencies} from '../tools/lib/import-dependencies.mjs';
import {acceptDependencies} from '../tools/lib/dependencies.mjs';
import {digest} from '../tools/lib/prepare.mjs';
import {atomicJson} from '../tools/lib/runtime-fs.mjs';

const data=Array.from({length:4},(_,i)=>Buffer.from(`fixture-batch-mod-${i}`));
const projects=data.map((bytes,i)=>({pakku_id:`new-${i}`,type:'MOD',id:{modrinth:`platform-${i}`},slug:{modrinth:`mod-${i}`},name:{modrinth:`Mod ${i}`},files:[{type:'modrinth',id:`version-${i}`,file_name:`mod-${i}.jar`,mc_versions:['1.21.1'],loaders:['fabric'],hashes:{sha512:digest(bytes,'sha512')}}]}));
async function ready(t,{unknown=false,mutate}={}) {
  const f=await setup(t),calls=[];
  const lockFile=path.join(f.root,f.target.path,'pakku-lock.json'),lock=JSON.parse(await fs.readFile(lockFile));
  lock.projects=[{pakku_id:'existing',type:'MOD',name:{modrinth:'Existing dependent'},id:{modrinth:'existing'},slug:{modrinth:'existing'},files:[{type:'modrinth',required_dependencies:['platform-0']}]}];
  await atomicJson(lockFile,lock);
  for(const [i,bytes] of data.entries())await save(path.join(f.gameDir,`mods/${i}.jar`),unknown&&i===3?Buffer.from('unknown'):bytes);
  const execute=async(_java,args,{cwd})=>{
    calls.push({args,cwd});
    if(args.includes('sync')) {
      assert.deepEqual(args.slice(-3),['--yes','sync','--additions']);
      const file=path.join(cwd,'pakku-lock.json'),candidate=JSON.parse(await fs.readFile(file));
      for(const name of await fs.readdir(path.join(cwd,'mods'))) {
        const bytes=await fs.readFile(path.join(cwd,'mods',name)),index=data.findIndex(d=>d.equals(bytes));
        if(index<0)continue; // Pakku can leave unknown JARs unresolved with a zero exit code.
        if(!candidate.projects.some(p=>p.pakku_id===projects[index].pakku_id))candidate.projects.push(structuredClone(projects[index]));
      }
      if(candidate.projects.some(p=>p.pakku_id==='new-0'))candidate.projects[0].pakku_links=['new-0'];
      mutate?.(candidate);await atomicJson(file,candidate);
    } else assert.equal(args.at(-1),'ls');
    return {code:0,stdout:'Pakku native fixture log\nProjects total: 5',stderr:''};
  };
  const scan=await scanImportDependencies(f.root,f.runtime,f.target),files=scan.candidates.map(({path,hash})=>({path,hash}));
  return {...f,lockFile,files,calls,execute};
}
const review=f=>importDependencies(f.root,f.runtime,f.target,{files:f.files,execute:f.execute});
const accept=(f,c,extra={})=>importDependencies(f.root,f.runtime,f.target,{candidate:c.id,acceptHash:c.hash,confirm:true,execute:f.execute,...extra});

test('Batch Import 四个 JAR 一次 sync、一份 Lock、一次写入及备份，Runtime 不变',async t=>{
  const f=await ready(t),before=await fs.readFile(f.lockFile),runtimeBefore=await snapshot(f.gameDir);
  // Exercise the public manifest interface, not only the programmatic array.
  const selection=path.join(f.base,'选中 mods.json');await atomicJson(selection,f.files);
  const c=await importDependencies(f.root,f.runtime,f.target,{selection,execute:f.execute});
  assert.equal(f.calls.filter(c=>c.args.includes('sync')).length,1);
  assert.equal(new Set(f.calls.map(c=>c.cwd)).size,1);
  assert.equal(c.recognized.length,4,JSON.stringify(c));assert.equal(c.pending,4);assert.equal(c.failed.length,0);
  assert.equal(c.importSource.files.length,4);assert.match(c.logs,/native fixture log/);
  assert.deepEqual(await fs.readFile(f.lockFile),before);
  assert.ok(!Object.keys(await snapshot(path.join(f.root,c.projectPath))).some(name=>name.endsWith('.jar')));
  await accept(f,c);
  assert.equal(JSON.parse(await fs.readFile(f.lockFile)).projects.length,5);
  const backups=await fs.readdir(path.join(f.root,'.local/collect'));assert.equal(backups.length,1);
  assert.deepEqual(await fs.readFile(path.join(f.root,'.local/collect',backups[0],'before')),before);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'.local/collect',backups[0],'record.json'))).status,'committed');
  assert.deepEqual(await snapshot(f.gameDir),runtimeBefore);
  assert.equal((await scanImportDependencies(f.root,f.runtime,f.target)).candidates.length,0);
});

test('Batch Import 部分未知来源不生成可接受候选、不部分写入',async t=>{
  const f=await ready(t,{unknown:true}),before=await snapshot(path.join(f.root,'packs')),c=await review(f);
  assert.equal(c.blocked,true);assert.equal(c.recognized.length,3);assert.equal(c.failed.length,1);assert.equal(c.pending,0);
  assert.equal(c.failed[0].path,'mods/3.jar');assert.match(c.failed[0].reason,/来源未知/);
  assert.equal(c.id,undefined);
  for(const id of await fs.readdir(path.join(f.root,'.work/candidates')))await assert.rejects(fs.access(path.join(f.root,'.work/candidates',id,'review.json')));
  await assert.rejects(accept(f,c));assert.deepEqual(await snapshot(path.join(f.root,'packs')),before);
});

test('Batch Import 同内容和重复选择只识别一次，已受管依赖明确跳过',async t=>{
  const f=await ready(t);await save(path.join(f.gameDir,'mods/copy.jar'),data[0]);
  f.files.push({path:'mods/copy.jar',hash:digest(data[0])},f.files[0]);
  const c=await review(f);assert.equal(c.recognized.length,4);assert.equal(c.skipped.length,2);assert.equal(c.pending,4);
  assert.equal(f.calls.filter(c=>c.args.includes('sync')).length,1);
  await accept(f,c);
  const next=await review(f);assert.equal(next.pending,0);assert.equal(next.skipped.length,6);assert.equal(next.blocked,false);
  assert.equal(f.calls.filter(c=>c.args.includes('sync')).length,1);
});

test('Batch Import 现有核心字段、非法 link、MC/Loader 冲突整批拒绝',async t=>{
  for(const mutate of [l=>l.projects[0].side='SERVER',l=>l.projects[0].pakku_links=['missing'],l=>l.projects[1].files[0].mc_versions=['1.20.1'],l=>l.projects[1].files[0].loaders=['neoforge'],l=>l.loaders.fabric='changed']) {
    const f=await ready(t,{mutate}),before=await fs.readFile(f.lockFile),c=await review(f);
    assert.equal(c.blocked,true);assert.equal(c.pending,0);assert.equal(c.id,undefined);assert.ok(c.failed.length);
    assert.deepEqual(await fs.readFile(f.lockFile),before);
  }
});

test('Batch Import 取消、候选过期及任一选中 JAR 变化都不能写入（含旧接受入口）',async t=>{
  for(const kind of ['cancel','source','jar-last','candidate','binding']) {
    const f=await ready(t),c=await review(f);
    if(kind==='source')await f.change('new source');
    if(kind==='jar-last')await save(path.join(f.gameDir,'mods/3.jar'),'changed');
    if(kind==='candidate')await fs.appendFile(path.join(f.root,c.projectPath,'pakku-lock.json'),' ');
    if(kind==='binding')await atomicJson(path.join(f.root,'.local/runtimes.json'),{schema:1,bindings:[]});
    const before=await snapshot(path.join(f.root,'packs')),opts={candidate:c.id,acceptHash:c.hash,confirm:kind!=='cancel',execute:f.execute};
    await assert.rejects(importDependencies(f.root,f.runtime,f.target,opts));
    await assert.rejects(acceptDependencies(f.root,f.target,opts));
    assert.deepEqual(await snapshot(path.join(f.root,'packs')),before);
    await assert.rejects(fs.access(path.join(f.root,'.local/collect')));
  }
});

test('Batch Import 写入前失败不留下部分 Lock，保留备份且不覆盖并发修改',async t=>{
  for(const kind of ['failure','jar','source']) {
    const f=await ready(t),before=await fs.readFile(f.lockFile),c=await review(f);
    await assert.rejects(accept(f,c,{beforeWrite:async()=>{
      if(kind==='failure')throw new Error('simulated write failure');
      if(kind==='jar')await save(path.join(f.gameDir,'mods/3.jar'),'changed');
      if(kind==='source')await fs.writeFile(f.lockFile,'external edit');
    }}));
    assert.deepEqual(await fs.readFile(f.lockFile),kind==='source'?Buffer.from('external edit'):before);
    const backups=await fs.readdir(path.join(f.root,'.local/collect'));assert.equal(backups.length,1);
    assert.deepEqual(await fs.readFile(path.join(f.root,'.local/collect',backups[0],'before')),before);
    assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'.local/collect',backups[0],'record.json'))).status,'prepared');
    assert.ok(!(await fs.readdir(path.dirname(f.lockFile))).some(name=>name.endsWith('.tmp')));
  }
});

test('Batch Import 拒绝非法列表与混用参数，扫描哈希变化不执行 Pakku',async t=>{
  const f=await ready(t);
  for(const files of [[],{},[{path:'mods/0.jar'}],[{path:'../a.jar',hash:'0'.repeat(64)}]])await assert.rejects(importDependencies(f.root,f.runtime,f.target,{files,execute:f.execute}),/批量列表/);
  await assert.rejects(importDependencies(f.root,f.runtime,f.target,{files:f.files,file:'mods/0.jar'}),/不能/);
  f.files[0].hash='0'.repeat(64);const c=await review(f);assert.equal(c.blocked,true);assert.equal(f.calls.length,0);
});



test('Batch Import 拒绝同平台重复项目/版本和工具失败，保留详细日志',async t=>{
  const f=await ready(t,{mutate:lock=>lock.projects.push({...structuredClone(lock.projects[1]),pakku_id:'duplicate-platform-project'})});
  const before=await fs.readFile(f.lockFile),conflict=await review(f);
  assert.equal(conflict.blocked,true);assert.match(conflict.failed[0].reason,/重复/);assert.ok(conflict.diff.text);assert.deepEqual(await fs.readFile(f.lockFile),before);
  const failed=await importDependencies(f.root,f.runtime,f.target,{files:f.files,execute:async()=>({code:2,stdout:'raw Pakku output',stderr:'network down'})});
  assert.equal(failed.blocked,true);assert.match(failed.logs,/raw Pakku output/);assert.match(failed.failed[0].reason,/network down/);
  assert.deepEqual(await fs.readFile(f.lockFile),before);
});

test('Batch Import 同一 Project 的不同内容 JAR 不作为普通重复项静默接受',async t=>{
  const f=await ready(t,{mutate:lock=>{
    const first=lock.projects.find(p=>p.pakku_id==='new-0'),second=lock.projects.find(p=>p.pakku_id==='new-1');
    first.files.push(...second.files);lock.projects=lock.projects.filter(p=>p!==second);
  }}),before=await fs.readFile(f.lockFile),c=await review(f);
  assert.equal(c.blocked,true);assert.match(c.failed[0].reason,/同一 Project/);assert.equal(c.pending,0);assert.equal(c.id,undefined);
  assert.deepEqual(await fs.readFile(f.lockFile),before);
});

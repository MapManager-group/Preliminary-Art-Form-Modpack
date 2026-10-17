import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setup,save,snapshot} from './sync-fixture.mjs';
import {scanImportDependencies,importDependencies} from '../tools/lib/import-dependencies.mjs';
import {acceptDependencies} from '../tools/lib/dependencies.mjs';
import {digest} from '../tools/lib/prepare.mjs';
import {atomicJson} from '../tools/lib/runtime-fs.mjs';

const bytes=Buffer.from('fixture-known-mod-not-executable');
// Synthetic files, but the project/link shape mirrors Pakku 1.5.0's Mod Menu -> Placeholder case.
const project={pakku_id:'ZDrlFfXwMztSRwQx',type:'MOD',slug:{modrinth:'placeholder-api'},name:{modrinth:'Text Placeholder API'},id:{modrinth:'fixture-placeholder-id'},files:[{type:'modrinth',file_name:'placeholder-api.jar',hashes:{sha1:digest(bytes,'sha1'),sha512:digest(bytes,'sha512')}}]};
const modMenu={pakku_id:'mod-menu-fixture',type:'MOD',side:'CLIENT',slug:{modrinth:'modmenu'},name:{modrinth:'Mod Menu'},id:{modrinth:'mOgUt4GM'},files:[{type:'modrinth',file_name:'modmenu.jar',id:'fixture-version',mc_versions:['1.21.1'],loaders:['fabric'],url:'https://example.invalid/modmenu.jar',hashes:{sha512:digest(Buffer.from('mod-menu-fixture'),'sha512')},required_dependencies:[project.id.modrinth]}]};
const execute=async(_java,args,{cwd})=>{
  if(args.includes('sync')) {
    assert.deepEqual(args.slice(-3),['--yes','sync','--additions']);
    const staged=await fs.readFile(path.join(cwd,'mods/import.jar'));
    const config=JSON.parse(await fs.readFile(path.join(cwd,'pakku.json')));await fs.writeFile(path.join(cwd,'pakku.json'),JSON.stringify(Object.fromEntries(Object.entries(config).reverse())));
    if(staged.equals(bytes)) {
      const lock=JSON.parse(await fs.readFile(path.join(cwd,'pakku-lock.json')));
      lock.projects=[...(lock.projects??[]),structuredClone(project)];
      // Mirror LockFile.linkProjectToDependents: a newly added dependency links existing dependents.
      for(const existing of lock.projects)if(existing.files.some(file=>(file.required_dependencies??[]).some(id=>Object.values(project.id).includes(id)))) {
        existing.pakku_links=[...new Set([...(existing.pakku_links??[]),project.pakku_id])];
      }
      await atomicJson(path.join(cwd,'pakku-lock.json'),lock);
    }
  }else assert.equal(args.at(-1),'ls');
  return {code:0,stdout:'Projects total: 1',stderr:''};
};
async function ready(t) {
  const f=await setup(t);await save(path.join(f.gameDir,'mods/new.jar'),bytes);
  const lockFile=path.join(f.root,f.target.path,'pakku-lock.json'),lock=JSON.parse(await fs.readFile(lockFile));
  lock.projects=[structuredClone(modMenu)];await atomicJson(lockFile,lock);
  const scan=await scanImportDependencies(f.root,f.runtime,f.target);
  return {...f,selection:{file:'mods/new.jar',sha256:scan.candidates[0].hash,execute}};
}
const review=f=>importDependencies(f.root,f.runtime,f.target,f.selection);
const accept=(f,c,extra={})=>importDependencies(f.root,f.runtime,f.target,{candidate:c.id,acceptHash:c.hash,confirm:true,execute,...extra});

test('Import 扫描只读，按锁文件哈希识别已管理 JAR，跳过禁用和嵌套文件',async t=>{
  const f=await ready(t);
  await save(path.join(f.gameDir,'mods/off.jar.disabled'),bytes);await save(path.join(f.gameDir,'mods/sub/nested.jar'),bytes);
  const lockFile=path.join(f.root,f.target.path,'pakku-lock.json'),lock=JSON.parse(await fs.readFile(lockFile));
  lock.projects=[project];await atomicJson(lockFile,lock);
  const before=await snapshot(f.base),scan=await scanImportDependencies(f.root,f.runtime,f.target);
  assert.equal(scan.candidates.length,0);assert.equal(scan.skipped.length,3);assert.deepEqual(await snapshot(f.base),before);
});

test('Import 只在确认后接受 Pakku 候选，不复制 JAR；结果可以由 Git 检查',async t=>{
  const f=await ready(t),sourceBefore=await snapshot(path.join(f.root,'packs')),runtimeBefore=await snapshot(f.gameDir);
  await assert.rejects(importDependencies(f.root,f.runtime,f.target,{...f.selection,sha256:'0'.repeat(64)}),/扫描哈希/);
  await assert.rejects(importDependencies(f.root,f.runtime,f.target,{...f.selection,confirm:true}),/先生成/);
  const c=await review(f);assert.equal(c.project,'placeholder-api');assert.equal(c.added.length,1);
  assert.deepEqual(c.added[0].name,{modrinth:'Text Placeholder API'});
  const candidateLock=JSON.parse(await fs.readFile(path.join(f.root,c.projectPath,'pakku-lock.json')));
  assert.deepEqual(candidateLock.projects.find(p=>p.pakku_id===modMenu.pakku_id),{...modMenu,pakku_links:[project.pakku_id]});
  assert.deepEqual(await snapshot(path.join(f.root,'packs')),sourceBefore);
  assert.ok(!(await snapshot(path.join(f.root,c.projectPath)))['mods/import.jar']);
  await assert.rejects(accept(f,c,{confirm:false}),/confirm/);
  await assert.rejects(accept(f,c,{acceptHash:'0'.repeat(64)}),/哈希/);
  await accept(f,c);
  const after=await snapshot(path.join(f.root,'packs'));
  assert.deepEqual(Object.keys(after),Object.keys(sourceBefore));
  assert.deepEqual(Object.keys(after).filter(n=>after[n]!==sourceBefore[n]),['example/pakku-lock.json']);
  assert.deepEqual(await snapshot(f.gameDir),runtimeBefore);
  assert.equal((await scanImportDependencies(f.root,f.runtime,f.target)).candidates.length,0);
});

test('Import 拒绝未知 JAR、原生工具失败和对已有依赖的修改',async t=>{
  const f=await ready(t),before=await snapshot(path.join(f.root,'packs'));
  await save(path.join(f.gameDir,'mods/unknown.jar'),'unknown');
  await assert.rejects(importDependencies(f.root,f.runtime,f.target,{file:'mods/unknown.jar',sha256:digest(Buffer.from('unknown')),execute}),/未唯一识别/);
  await assert.rejects(importDependencies(f.root,f.runtime,f.target,{...f.selection,execute:async()=>({code:1,stderr:'network failed'})}),/network failed/);
  const lockFile=path.join(f.root,f.target.path,'pakku-lock.json'),lock=JSON.parse(await fs.readFile(lockFile));
  lock.projects=[{...project,pakku_id:'old',files:[],slug:{modrinth:'old'}}];await atomicJson(lockFile,lock);
  await assert.rejects(importDependencies(f.root,f.runtime,f.target,{...f.selection,execute:async(java,args,options)=>{
    const result=await execute(java,args,options);if(args.includes('sync')){const p=path.join(options.cwd,'pakku-lock.json'),l=JSON.parse(await fs.readFile(p));l.projects.shift();await atomicJson(p,l);}return result;
  }}),/现有依赖/);
  assert.equal(JSON.parse(await fs.readFile(lockFile)).projects.length,1);
  assert.equal((await snapshot(f.gameDir))['mods/new.jar'],digest(bytes));
  assert.ok(before['example/pakku-lock.json']);
});

test('Import 候选在源、Runtime JAR、绑定或候选哈希变化后失效',async t=>{
  for(const mutation of ['source','jar','binding','candidate']) {
    const f=await ready(t),c=await review(f);
    if(mutation==='source')await f.change('source changed');
    if(mutation==='jar')await save(path.join(f.gameDir,'mods/new.jar'),'changed');
    if(mutation==='binding')await atomicJson(path.join(f.root,'.local/runtimes.json'),{schema:1,bindings:[]});
    if(mutation==='candidate')await fs.appendFile(path.join(f.root,c.projectPath,'pakku-lock.json'),' ');
    const before=await snapshot(path.join(f.root,'packs'));
    await assert.rejects(accept(f,c));
    // The legacy accept command also enforces the import-source guard.
    await assert.rejects(acceptDependencies(f.root,f.target,{candidate:c.id,acceptHash:c.hash,confirm:true,execute}));
    assert.deepEqual(await snapshot(path.join(f.root,'packs')),before);
  }
});

async function reviewMutated(f,mutate) {
  return importDependencies(f.root,f.runtime,f.target,{...f.selection,execute:async(java,args,options)=>{
    const result=await execute(java,args,options);
    if(args.includes('sync')) {
      const file=path.join(options.cwd,'pakku-lock.json'),lock=JSON.parse(await fs.readFile(file));
      mutate(lock);await atomicJson(file,lock);
    }
    return result;
  }});
}

test('Import 已有 Mod Menu 核心字段变化，即使有合法新 link 也拒绝',async t=>{
  const mutations={
    pakku_id:p=>p.pakku_id='different-id',type:p=>p.type='RESOURCE_PACK',side:p=>p.side='SERVER',
    slug:p=>p.slug.modrinth='changed',name:p=>p.name.modrinth='changed',id:p=>p.id.modrinth='changed',
    version:p=>p.files[0].id='another-version',file:p=>p.files[0].file_name='another.jar',
    hash:p=>p.files[0].hashes.sha512='0'.repeat(128),url:p=>p.files[0].url='https://example.invalid/other.jar',
    minecraft:p=>p.files[0].mc_versions=['1.21.2'],loader:p=>p.files[0].loaders=['neoforge'],
    files:p=>p.files=[],futureField:p=>p.new_core_field=true,
  };
  for(const [name,mutate] of Object.entries(mutations))await t.test(name,async t=>{
    const f=await ready(t),before=await snapshot(path.join(f.root,'packs'));
    await assert.rejects(reviewMutated(f,lock=>mutate(lock.projects[0])),/现有依赖/);
    assert.deepEqual(await snapshot(path.join(f.root,'packs')),before);
  });
});

test('Import link 集合仅可增加本次新增 Project，拒绝删除、陌生或已有 Project link',async t=>{
  for(const kind of ['removed','missing','old-project','self','duplicate','null','string'])await t.test(kind,async t=>{
    const f=await ready(t),file=path.join(f.root,f.target.path,'pakku-lock.json'),lock=JSON.parse(await fs.readFile(file));
    lock.projects.push({...structuredClone(modMenu),pakku_id:'other-existing',id:{modrinth:'other-id'},files:[]});
    if(kind==='removed')lock.projects[0].pakku_links=['other-existing'];
    await atomicJson(file,lock);const before=await snapshot(path.join(f.root,'packs'));
    await assert.rejects(reviewMutated(f,candidate=>{
      const p=candidate.projects[0];
      if(kind==='removed')p.pakku_links=[project.pakku_id];
      if(kind==='missing')p.pakku_links.push('not-in-candidate');
      if(kind==='old-project')p.pakku_links.push('other-existing');
      if(kind==='self')p.pakku_links.push(p.pakku_id);
      if(kind==='duplicate')p.pakku_links.push(project.pakku_id);
      if(kind==='null')p.pakku_links=null;
      if(kind==='string')p.pakku_links=project.pakku_id;
    }),/pakku_links/);
    assert.deepEqual(await snapshot(path.join(f.root,'packs')),before);
  });
});

test('Import 保留旧 link，允许集合重排及新增关联，旧项目不计入 added',async t=>{
  const f=await ready(t),file=path.join(f.root,f.target.path,'pakku-lock.json'),lock=JSON.parse(await fs.readFile(file));
  lock.projects.push({...structuredClone(modMenu),pakku_id:'previous-dependency',files:[],id:{modrinth:'previous-id'}});
  lock.projects[0].pakku_links=['previous-dependency'];await atomicJson(file,lock);
  const c=await reviewMutated(f,candidate=>{candidate.projects[0].pakku_links.reverse();candidate.projects.reverse();});
  assert.equal(c.added.length,1);assert.deepEqual(c.added[0].id,project.id);
  await accept(f,c);
  const current=JSON.parse(await fs.readFile(file));
  assert.deepEqual(new Set(current.projects.find(p=>p.pakku_id===modMenu.pakku_id).pakku_links),new Set(['previous-dependency',project.pakku_id]));
});

test('Import 顶层上下文与 Project 身份必须完整且唯一',async t=>{
  const mutations={
    target:l=>l.target='curseforge',minecraft:l=>l.mc_versions=['1.21.2'],loader:l=>l.loaders.fabric='changed',
    duplicate:l=>l.projects.push(structuredClone(l.projects[1])),missing:l=>delete l.projects[1].pakku_id,
    dangling:l=>l.projects[1].pakku_links=['missing'],
  };
  for(const [name,mutate] of Object.entries(mutations))await t.test(name,async t=>{
    const f=await ready(t),before=await snapshot(path.join(f.root,'packs'));
    await assert.rejects(reviewMutated(f,mutate));
    assert.deepEqual(await snapshot(path.join(f.root,'packs')),before);
  });
});

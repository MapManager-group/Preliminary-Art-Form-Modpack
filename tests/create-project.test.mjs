import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {zipSync} from 'fflate';
import {createProject,inspectPack} from '../tools/lib/create-project.mjs';
import {build} from '../tools/lib/build.mjs';
import {checkTarget} from '../tools/lib/check.mjs';
import {loadWorkspace,filesUnder} from '../tools/lib/workspace.mjs';
import {digest} from '../tools/lib/prepare.mjs';
import {inspectArchive} from '../tools/lib/archive.mjs';
import {setup,save,snapshot} from './sync-fixture.mjs';
const defaults={name:'New Pack',platform:'modrinth',mc:'1.21.1',loader:'fabric',loaderVersion:'0.16.14'};
const index=()=>({formatVersion:1,game:'minecraft',name:'Original',versionId:'1.0.0',summary:'Description',dependencies:{minecraft:'1.21.1','fabric-loader':'0.16.14'},files:[]});
const dep=(name='demo',env={client:'required',server:'required'})=>{const b=Buffer.from('jar '+name);return {path:`mods/${name}.jar`,hashes:{sha512:digest(b,'sha512'),sha1:digest(b,'sha1')},fileSize:b.length,downloads:[`https://example.invalid/${name}.jar`],env};};
async function pack(f,manifest=index(),entries={}) {const file=path.join(f.base,'input.mrpack');await fs.writeFile(file,zipSync({'modrinth.index.json':Buffer.from(JSON.stringify(manifest)),...entries}));return file;}
// Model the native API boundary: init supplies defaults, import may silently omit unknown hashes,
// cfg owns project properties, export derives paths/side from the resulting Pakku data.
function native(behavior={}) {
  const calls=[];
  const execute=async(_exe,args,{cwd})=>{
    const a=args.slice(args.indexOf('--working-path')+2).filter(x=>x!=='--yes'),command=a[0];calls.push({args:a,cwd});
    const read=async file=>JSON.parse(await fs.readFile(path.join(cwd,file),'utf8'));
    const write=async(file,value)=>save(path.join(cwd,file),JSON.stringify(value));
    const value=key=>a[a.indexOf(key)+1];
    if(behavior.fail===command)return {code:17,stdout:'',stderr:'fixture failure'};
    if(command==='init') {
      await write('pakku.json',{name:value('--name'),version:value('--version'),overrides:['config']});
      const [loader,version]=value('--loaders').split('=');
      await write('pakku-lock.json',{lockfile_version:2,target:value('--target'),mc_versions:[value('--mc-versions')],loaders:{[loader]:version},projects:[]});
    } else if(command==='import') {
      const manifest=JSON.parse(await fs.readFile(a[1],'utf8')),lock=await read('pakku-lock.json');
      lock.projects=manifest.files.filter(f=>!f.path.includes('unknown')).map((f,i)=>({pakku_id:`pakku-${i}`,id:{modrinth:`id-${i}`},name:{modrinth:`Mod ${i}`},type:'MOD',side:'BOTH',files:[{type:'modrinth',name:path.basename(f.path),hashes:f.hashes,size:f.fileSize,url:f.downloads[0],mc_versions:['1.21.1'],loaders:['fabric']}]}));
      if(behavior.wrongLoader&&lock.projects[0])lock.projects[0].files[0].loaders=['forge'];
      await write('pakku-lock.json',lock);
    } else if(command==='cfg') {
      const config=await read('pakku.json');config.projects??={};config.projects[a.at(-1)]={side:value('--side'),update_strategy:value('--update-strategy')};await write('pakku.json',config);
    } else if(command==='export') {
      const config=await read('pakku.json'),lock=await read('pakku-lock.json');
      const manifest={...index(),name:config.name,versionId:config.version,dependencies:{minecraft:lock.mc_versions[0],[lock.loaders.fabric?'fabric-loader':'neoforge']:Object.values(lock.loaders)[0]},files:lock.projects.map(p=>{
        const f=p.files[0],side=config.projects?.[p.id.modrinth]?.side??p.side;
        return {path:'mods/'+f.name,hashes:f.hashes,fileSize:f.size,downloads:[f.url],env:{client:side==='SERVER'&&!config.export_server_side_projects_to_client?'unsupported':'required',server:side==='CLIENT'?'unsupported':'required'}};
      })};
      if(behavior.sideDrift)for(const file of manifest.files)file.env.client='required';
      if(behavior.drift&&manifest.files[0])manifest.files[0].path='mods/changed.jar';
      const overrides={},server={},client={};
      for(const folder of ['overrides','client-overrides','server-overrides']) {
        const base=path.join(cwd,'.pakku',folder);let names=[];try{names=await filesUnder(base);}catch(e){if(e.code!=='ENOENT')throw e;}
        for(const name of names){const bytes=await fs.readFile(path.join(base,name));overrides[folder+'/'+name]=bytes;if(folder!=='client-overrides')server[name]=bytes;if(folder!=='server-overrides')client['overrides/'+name]=bytes;}
      }
      await save(path.join(cwd,'build/.cache/modrinth/client-overrides/resourcepacks/local.zip'),zipSync({}));
      const name=config.name+'-'+config.version;
      if(lock.target!=='curseforge')await save(path.join(cwd,'build/modrinth',name+'.mrpack'),zipSync({'modrinth.index.json':Buffer.from(JSON.stringify(manifest)),...overrides}));
      if(lock.target!=='modrinth')await save(path.join(cwd,'build/curseforge',name+'.zip'),zipSync({'manifest.json':Buffer.from(JSON.stringify({manifestVersion:1,minecraft:{version:lock.mc_versions[0]},files:[]})),...client}));
      await save(path.join(cwd,'build/serverpack',name+'.zip'),zipSync(server));
    }
    return {code:0,stdout:command==='ls'?'Projects total: 0':command==='export'?"[modrinth profile] exported to 'build'":'ok',stderr:''};
  };return {execute,calls};
}

test('空白预览只读，确认后原生初始化、注册、check 与三平台构建',async t=>{
  for(const platform of ['modrinth','curseforge','multiplatform']) {
    const f=await setup(t),mock=native(),options={...defaults,name:'Pack-curseforge',platform,execute:mock.execute};
    const before=await snapshot(f.root),preview=await createProject(f.root,'new-pack',options);
    assert.deepEqual(await snapshot(f.root),before);assert.equal(mock.calls.length,0);
    const result=await createProject(f.root,'new-pack',{...options,confirm:true,acceptHash:preview.acceptHash});
    assert.equal(result.created,true);const target=(await loadWorkspace(f.root)).targets.find(x=>x.id==='new-pack');
    assert.ok(target);await checkTarget(f.root,target,options);const built=await build(f.root,target,options);
    assert.equal(built.report.missing.length,0);assert.equal(built.report.uncollected.length,0);
    assert.equal(new Set(built.report.artifacts.map(a=>a.name)).size,target.artifacts.length);
    assert.ok(mock.calls.every(call=>call.cwd!==f.gameDir));
    assert.deepEqual((await fs.readdir(path.join(f.root,'.work'))).filter(n=>n.startsWith('create-')),[]);
  }
});
test('MRPACK 原生依赖、侧别与三种覆盖目录转换，候选确认才注册，可构建',async t=>{
  const f=await setup(t),mock=native(),manifest=index();manifest.files=[dep('common'),dep('client',{client:'required',server:'unsupported'}),dep('server',{client:'unsupported',server:'required'})];
  const file=await pack(f,manifest,{'overrides/config/a.json':Buffer.from('common'),'client-overrides/config/a.json':Buffer.from('client'),'server-overrides/config/server.json':Buffer.from('server'),'overrides/empty/':new Uint8Array()});
  const original=await fs.readFile(file),workspace=await fs.readFile(path.join(f.root,'workspace.json'));
  const preview=await createProject(f.root,'converted',{name:'Converted',platform:'modrinth',file,execute:mock.execute});
  assert.equal(preview.blocked,false);assert.equal(preview.converted.length,3);assert.equal(preview.overrides.length,3);assert.equal(preview.skipped.length,1);
  await assert.rejects(fs.access(path.join(f.root,'packs/converted')));assert.deepEqual(await fs.readFile(path.join(f.root,'workspace.json')),workspace);
  const result=await createProject(f.root,'converted',{candidate:preview.candidate,acceptHash:preview.acceptHash,confirm:true,execute:mock.execute});
  assert.equal(result.created,true);assert.deepEqual(await fs.readFile(file),original);
  const target=(await loadWorkspace(f.root)).targets.at(-1),info=await checkTarget(f.root,target,{execute:mock.execute});
  assert.equal(info.config.export_server_side_projects_to_client,false);
  assert.equal(info.lock.projects.length,3);assert.equal(info.mapping.length,3);
  const built=await build(f.root,target,{execute:mock.execute});assert.equal(built.artifacts.length,2);
  const server=inspectArchive(built.artifacts.find(a=>a.kind==='serverpack').bytes,'serverpack');assert.equal(Buffer.from(server['config/a.json']).toString(),'common');
});
test('无法识别、可选侧别、依赖元数据或导出漂移明确报告且不注册',async t=>{
  for(const kind of ['unknown','optional','loader','drift','side']) {
    const f=await setup(t),manifest=index(),mock=native({wrongLoader:kind==='loader',drift:kind==='drift',sideDrift:kind==='side'});
    manifest.files=[dep(kind==='unknown'?'unknown':'demo',kind==='optional'?{client:'optional',server:'required'}:kind==='side'?{client:'unsupported',server:'required'}:undefined)];
    const file=await pack(f,manifest,{});
    const before=await fs.readFile(path.join(f.root,'workspace.json'));
    const report=await createProject(f.root,'blocked',{name:'Blocked',platform:'modrinth',file,execute:mock.execute});
    assert.equal(report.blocked,true,kind);assert.ok(report.issues.length);assert.equal(report.candidate,undefined);
    assert.deepEqual(await fs.readFile(path.join(f.root,'workspace.json')),before);await assert.rejects(fs.access(path.join(f.root,'packs/blocked')));
    if(await fs.stat(path.join(f.root,'.work')).catch(()=>null))assert.deepEqual(await fs.readdir(path.join(f.root,'.work')),[]);
  }
});
test('MRPACK 元数据、恶意路径、重复依赖、非法下载地址拒绝',async t=>{
  const f=await setup(t);
  for(const modify of [m=>m.formatVersion=2,m=>m.dependencies.evil='1',m=>m.dependencies['forge']='1',m=>m.files=[{...dep(),path:'../escape.jar'}],m=>m.files=[dep(),dep()],m=>m.files=[{...dep(),downloads:['file:///secret']}],m=>m.files=[{...dep(),env:{client:'bad'}}]]) {
    const manifest=index();modify(manifest);await assert.rejects(inspectPack(await pack(f,manifest)));
  }
  for(const name of ['overrides/../escape','overrides/saves/world/file','client-overrides/config/CON','evil.txt'])await assert.rejects(inspectPack(await pack(f,index(),{[name]:Buffer.from('bad')})));
  assert.deepEqual(inspectArchive(zipSync({}),'serverpack'),{});
});
test('重复 Target、现有目录、危险 ID 与过期空白预览拒绝',async t=>{
  const f=await setup(t),mock=native();
  for(const id of ['example','../escape','CON','bad/name','foo.'])await assert.rejects(createProject(f.root,id,{...defaults,execute:mock.execute}));
  await fs.mkdir(path.join(f.root,'packs/occupied'));await assert.rejects(createProject(f.root,'occupied',defaults),/已存在/);
  const preview=await createProject(f.root,'new',defaults);
  await fs.appendFile(path.join(f.root,'workspace.json'),'\n');
  await assert.rejects(createProject(f.root,'new',{...defaults,acceptHash:preview.acceptHash,confirm:true,execute:mock.execute}),/变化/);
  assert.equal(mock.calls.length,0);
});
test('初始化、检查、注册中断与并发 workspace 修改均回滚自建目录',async t=>{
  for(const failure of ['init','ls','register','commit','concurrent']) {
    const f=await setup(t),mock=native({fail:failure}),preview=await createProject(f.root,'new',defaults);
    const file=path.join(f.root,'workspace.json'),original=await fs.readFile(file,'utf8');
    const options={...defaults,execute:mock.execute,acceptHash:preview.acceptHash,confirm:true};
    if(failure==='register')options.beforeRegister=async()=>{throw Error('register failed');};
    if(failure==='commit')options.beforeCommit=async()=>{throw Error('commit failed');};
    if(failure==='concurrent')options.beforeRegister=async()=>fs.writeFile(file,original+'\n');
    await assert.rejects(createProject(f.root,'new',options));
    await assert.rejects(fs.access(path.join(f.root,'packs/new')));
    assert.equal(await fs.readFile(file,'utf8'),original+(failure==='concurrent'?'\n':''));
    assert.deepEqual(await fs.readdir(path.join(f.root,'.work')),[]);
  }
});
test('候选锁文件、原包和工作区变化拒绝接受，取消不注册',async t=>{
  for(const change of ['candidate','input','workspace']) {
    const f=await setup(t),mock=native(),file=await pack(f);
    const preview=await createProject(f.root,'new',{name:'New',platform:'modrinth',file,execute:mock.execute});
    if(change==='candidate')await fs.appendFile(path.join(f.root,`.work/create-${preview.candidate}/project/pakku-lock.json`),'\n');
    if(change==='input')await pack(f,{...index(),name:'Changed'});
    if(change==='workspace')await fs.appendFile(path.join(f.root,'workspace.json'),'\n');
    await assert.rejects(createProject(f.root,'new',{candidate:preview.candidate,acceptHash:preview.acceptHash,confirm:true,execute:mock.execute}),/变化/);
    await assert.rejects(fs.access(path.join(f.root,'packs/new')));
    assert.equal((await loadWorkspace(f.root)).targets.length,1);
  }
});

test('MRPACK 内嵌本地 Mod、资源包、光影及解包资源按原侧别保留并可构建',async t=>{
  const f=await setup(t),mock=native();
  const resources={
    'overrides/mods/local.jar':zipSync({'fabric.mod.json':Buffer.from('{}')}),
    'client-overrides/resourcepacks/local.zip':zipSync({'pack.mcmeta':Buffer.from('{}')}),
    'client-overrides/shaderpacks/local.zip':zipSync({'shaders/a.fsh':Buffer.from('shader')}),
    'client-overrides/resourcepacks/unpacked/assets/example/textures/a.png':Buffer.from([0,255,1,2]),
    'server-overrides/mods/server.jar':zipSync({'META-INF/mods.toml':Buffer.from('test')}),
  };
  const file=await pack(f,index(),resources),original=await fs.readFile(file);
  const preview=await createProject(f.root,'local-assets',{name:'Assets',platform:'modrinth',file,execute:mock.execute});
  assert.equal(preview.blocked,false);assert.equal(preview.overrides.length,5);assert.equal(preview.converted.length,0);
  await createProject(f.root,'local-assets',{candidate:preview.candidate,acceptHash:preview.acceptHash,confirm:true,execute:mock.execute});
  const target=(await loadWorkspace(f.root)).targets.at(-1),info=await checkTarget(f.root,target,{execute:mock.execute});
  assert.equal(info.lock.projects.length,0,'local files must not become invented hosted projects');
  const built=await build(f.root,target,{execute:mock.execute});assert.deepEqual(built.report.uncollected,[]);
  const client=inspectArchive(built.artifacts.find(a=>a.kind==='modrinth').bytes,'modrinth');
  for(const [name,bytes] of Object.entries(resources))assert.deepEqual(Buffer.from(client[name]),Buffer.from(bytes));
  const server=inspectArchive(built.artifacts.find(a=>a.kind==='serverpack').bytes,'serverpack');
  assert.ok(server['mods/local.jar']);assert.ok(server['mods/server.jar']);assert.ok(!server['resourcepacks/local.zip']);
  assert.deepEqual(await fs.readFile(file),original);
});

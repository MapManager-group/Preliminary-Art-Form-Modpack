// Network regression: actual Pakku 1.5.0 and the two versions from the reported failure.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {pakku,requireSuccess,verifiedTool,run} from './lib/pakku.mjs';
import {bindRuntime} from './lib/runtimes.mjs';
import {scanImportDependencies,importDependencies} from './lib/import-dependencies.mjs';
import {checkTarget} from './lib/check.mjs';
import {atomicJson} from './lib/runtime-fs.mjs';
import {digest} from './lib/prepare.mjs';
import {filesUnder} from './lib/workspace.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tool=await verifiedTool(repo);
const root=await fs.mkdtemp(path.join(os.tmpdir(),'DB runtime import-'));
const snapshot=async dir=>Object.fromEntries(await Promise.all((await filesUnder(dir)).map(async f=>[f,digest(await fs.readFile(path.join(dir,f)))])));
let success=false;
try {
  const projectRoot=path.join(root,'project'),gameDir=path.join(root,'launcher/versions/Example');
  await fs.mkdir(path.join(projectRoot,'.cache'),{recursive:true});
  await fs.copyFile(path.join(repo,'toolchain.json'),path.join(projectRoot,'toolchain.json'));
  await fs.copyFile(tool.jar,path.join(projectRoot,`.cache/pakku-${tool.version}.jar`));
  const target={id:'import-test',path:'packs/import-test',artifacts:['modrinth']},dir=path.join(projectRoot,target.path);
  await fs.mkdir(dir,{recursive:true});await atomicJson(path.join(projectRoot,'workspace.json'),{targets:[target]});
  requireSuccess(await pakku(projectRoot,dir,['--yes','init','--name','Runtime-Import-Test','--version','0.1.0','--mc-versions','26.2','--loaders','fabric=0.19.2','--target','modrinth'],{capture:true}));
  const beforeConfig={...JSON.parse(await fs.readFile(path.join(dir,'pakku.json'))),description:'',author:'',overrides:[],client_overrides:[],server_overrides:[],paths:{},projects:{radial:{type:null,side:null,update_strategy:null,redistributable:null,subpath:null,aliases:null,export:null}},export_server_side_projects_to_client:false};
  await atomicJson(path.join(dir,'pakku.json'),beforeConfig);
  await fs.cp(path.join(repo,'tests/fixtures/launcher-pcl2'),path.join(root,'launcher'),{recursive:true});
  await atomicJson(path.join(gameDir,'Example.json'),{id:'Example',clientVersion:'26.2',libraries:[{name:'net.fabricmc:fabric-loader:0.19.2'}]});
  const runtime=(await bindRuntime(projectRoot,target,'test',{launcher:'pcl2',gameDir,confirmGameDir:true})).runtime;
  await fs.mkdir(path.join(gameDir,'mods'));
  for(const [id,filename,sha512] of [
    ['pMOutbvD','radial-3.2.0+26.2.jar','1d462be0784c0f9cefe9360253ffabd4a9acec3a55f3b3b477a0ba5cd643863eba81e3a2f9dcf9011a3c1c089f262b4fc99859005161fb5523339e711f45cc4e'],
    ['roOTvshj','renice-shot-1.2.1+mc26.2.jar','17b28765fa2e32b9b742208cbfb1dffeada014f96e8c85808b4bc45561e6ba68b9ecb8f35ef6621c0bdcaa26bfe0adf3a84a6704b9f82a9967fb1d4229b3da64'],
  ]) {
    const response=await fetch('https://api.modrinth.com/v2/version/'+id,{signal:AbortSignal.timeout(30000)});assert.equal(response.ok,true);
    const version=await response.json(),file=version.files.find(f=>f.filename===filename);assert.equal(file.hashes.sha512,sha512);
    const download=await fetch(file.url,{signal:AbortSignal.timeout(60000)});assert.equal(download.ok,true);
    const bytes=Buffer.from(await download.arrayBuffer());assert.equal(digest(bytes,'sha512'),sha512);
    await fs.writeFile(path.join(gameDir,'mods',filename),bytes);
  }
  const formal=await snapshot(dir),runtimeBefore=await snapshot(gameDir);
  const files=(await scanImportDependencies(projectRoot,runtime,target)).candidates.map(({path,hash})=>({path,hash}));
  const review=extra=>importDependencies(projectRoot,runtime,target,{files,...extra});
  const candidate=await review();assert.equal(candidate.blocked,false,JSON.stringify(candidate));assert.equal(candidate.recognized.length,2);assert.equal(candidate.pending,2);
  const actualConfig=JSON.parse(await fs.readFile(path.join(projectRoot,candidate.projectPath,'pakku.json')));
  assert.deepEqual(actualConfig,{name:'Runtime-Import-Test',version:'0.1.0',projects:{radial:{}}});
  console.log('真实 sync 配置变化:',candidate.configChanges.join(', '));
  assert.ok(candidate.configHash);assert.ok(candidate.configDiff.text);
  const accept=extra=>importDependencies(projectRoot,runtime,target,{candidate:candidate.id,acceptHash:candidate.hash,confirm:true,...extra});
  await assert.rejects(accept({confirm:false}));assert.deepEqual(await snapshot(dir),formal);
  await assert.rejects(accept({beforeFileWrite:(_name,index)=>{if(index===1)throw new Error('integration write failure');}}),/integration write failure/);
  assert.deepEqual(await snapshot(dir),formal);
  // Run the real sync, then introduce an unrelated mutation: the wrapper must reject it.
  const invalid=await review({execute:async(executable,args,options)=>{
    const result=await run(executable,args,options);
    if(args.includes('sync')) {const file=path.join(options.cwd,'pakku.json'),config=JSON.parse(await fs.readFile(file));await atomicJson(file,{...config,author:'unrelated edit'});}
    return result;
  }});
  assert.equal(invalid.blocked,true);assert.match(invalid.failed[0].reason,/项目配置/);assert.deepEqual(await snapshot(dir),formal);
  // Pakku can exit zero for an unrecognized JAR; fail the entire batch nonetheless.
  const unknown=Buffer.from('unrecognized integration JAR');await fs.writeFile(path.join(gameDir,'mods/unknown.jar'),unknown);
  const failed=await review({files:[...files,{path:'mods/unknown.jar',hash:digest(unknown)}]});
  assert.equal(failed.blocked,true);assert.equal(failed.id,undefined);assert.equal(failed.failed.length,1);assert.deepEqual(await snapshot(dir),formal);
  await fs.unlink(path.join(gameDir,'mods/unknown.jar'));
  const result=await accept();assert.equal(result.files.length,2);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'pakku.json'))),actualConfig);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'pakku-lock.json'))).projects.length,2);
  for(const name of ['pakku.json','pakku-lock.json'])assert.equal(digest(await fs.readFile(path.join(projectRoot,result.backup,'before',name))),formal[name]);
  await checkTarget(projectRoot,target);assert.deepEqual(await snapshot(gameDir),runtimeBefore);
  assert.equal((await scanImportDependencies(projectRoot,runtime,target)).candidates.length,0);
  success=true;console.log(`PASS: Pakku ${tool.version} 双 Mod 识别、默认值省略、取消、配置拒绝、整批失败、双文件回滚/确认及只读检查`);
} catch(error) {console.error(`失败副本: ${root}`);throw error;}
finally {
  // Only this mkdtemp-owned tree is removed; failures remain available for diagnosis.
  if(success)await fs.rm(root,{recursive:true,force:true});
}

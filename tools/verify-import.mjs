// Network integration against fixed Pakku and one pinned Modrinth version; temporary source only.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {zipSync} from 'fflate';
import {nativeWorkspace} from '../tests/pakku-fixture.mjs';
import {createProject} from './lib/create-project.mjs';
import {build,inspectArchive} from './lib/build.mjs';
import {prepare} from './lib/prepare.mjs';
import {sha256,verifiedTool} from './lib/pakku.mjs';
import {loadWorkspace} from './lib/workspace.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tool=await verifiedTool(repo);
const root=await fs.mkdtemp(path.join(os.tmpdir(),'DB SERVER 导入-'));
try {
  await fs.copyFile(path.join(repo,'toolchain.json'),path.join(root,'toolchain.json'));
  await fs.mkdir(path.join(root,'.cache'));await fs.copyFile(tool.jar,path.join(root,`.cache/pakku-${tool.version}.jar`));
  await nativeWorkspace(root);
  // ServerCore 1.5.19+1.21.1 (Fabric). Never resolve a floating "latest" in this regression.
  const response=await fetch('https://api.modrinth.com/v2/version/GQ2a51Rl',{signal:AbortSignal.timeout(30000)});
  assert.equal(response.ok,true);const version=await response.json();assert.equal(version.id,'GQ2a51Rl');
  assert.ok(version.game_versions.includes('1.21.1'));assert.ok(version.loaders.includes('fabric'));
  const file=version.files.find(f=>f.primary);assert.ok(file);
  const index={formatVersion:1,game:'minecraft',name:'Server Side Fixture',versionId:'0.1.0',dependencies:{minecraft:'1.21.1','fabric-loader':'0.16.14'},files:[{path:'mods/'+file.filename,hashes:file.hashes,downloads:[file.url],fileSize:file.size,env:{client:'unsupported',server:'required'}}]};
  const input=path.join(root,'server.mrpack');await fs.writeFile(input,zipSync({'modrinth.index.json':Buffer.from(JSON.stringify(index))}));
  const original=sha256(await fs.readFile(input));
  const candidate=await createProject(root,'imported',{name:'Imported',platform:'modrinth',file:input});
  assert.equal(candidate.blocked,false,JSON.stringify(candidate));assert.equal(candidate.converted.length,1);
  await createProject(root,'imported',{candidate:candidate.candidate,acceptHash:candidate.acceptHash,confirm:true});
  const target=(await loadWorkspace(root)).targets.find(t=>t.id==='imported');
  const result=await build(root,target);
  const exported=inspectArchive(result.artifacts.find(a=>a.kind==='modrinth').bytes,'modrinth');
  const actual=JSON.parse(Buffer.from(exported['modrinth.index.json']).toString());
  assert.deepEqual(actual.files[0].env,index.files[0].env);
  assert.deepEqual(actual.files[0].hashes,index.files[0].hashes);
  assert.equal(actual.files[0].path,index.files[0].path);assert.equal(actual.files.length,1);
  assert.ok(!((await prepare(root,target)).files.some(f=>f.path===index.files[0].path)),'SERVER 不进入客户端部署清单');
  assert.equal(sha256(await fs.readFile(input)),original);
  console.log(`PASS: Pakku ${tool.version} 原生 SERVER 导入、确认、构建、侧别/哈希保留、客户端排除；临时工程 ${root}`);
}catch(e){console.error(`失败副本: ${root}`);throw e;}

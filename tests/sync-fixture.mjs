import {writeFixture} from './pakku-fixture.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { bindRuntime } from '../tools/lib/runtimes.mjs';
import { sourceSnapshot, clientManifest, digest } from '../tools/lib/prepare.mjs';
import { atomicJson } from '../tools/lib/runtime-fs.mjs';
import { filesUnder } from '../tools/lib/workspace.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stopped={stopped:true,probe:async()=>({status:'not-observed',reason:'test fixture'})};
const save=async(file,data)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data);};
async function setup(t,launcher='pcl2') {
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'DB 部署 测试-'));
  // The only recursive cleanup target is this exact mkdtemp-owned fixture tree.
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const root=path.join(base,'project'),mcRoot=path.join(base,'launcher'),gameDir=path.join(mcRoot,'versions','Example');
  await fs.mkdir(root,{recursive:true});
  await fs.cp(path.join(repo,'tests/fixtures',`launcher-${launcher==='pcl2'?'pcl2':'hmcl'}`),mcRoot,{recursive:true});
  await writeFixture(path.join(root,'packs/example'));
  const target={id:'example',path:'packs/example',artifacts:['modrinth']};
  await atomicJson(path.join(root,'workspace.json'),{targets:[target]});
  const jar=Buffer.from('fixture-only-not-executable');
  await save(path.join(root,'.cache/pakku-1.5.0.jar'),jar);
  await atomicJson(path.join(root,'toolchain.json'),{pakku:{version:'1.5.0',sha256:digest(jar),url:'https://example.invalid/pakku.jar'}});
  const runtime=(await bindRuntime(root,target,'dev',{launcher,gameDir,confirmGameDir:true})).runtime;
  const stage=async(dependencies=[])=>{
    const info=await sourceSnapshot(root,target);
    const entries={'modrinth.index.json':Buffer.from(JSON.stringify({formatVersion:1,game:'minecraft',files:dependencies,dependencies:{minecraft:'1.21.1','fabric-loader':'0.16.14'}}))};
    for(const mapping of info.mapping)entries[mapping.archivePath]=await fs.readFile(path.join(info.dir,mapping.source));
    const manifest={schema:1,targetId:target.id,fingerprint:info.fingerprint,version:info.config.version,git:null,dirty:true,pakku:info.pakku,lockHash:info.hashes['pakku-lock.json'],configHash:info.hashes['pakku.json'],...clientManifest(entries,info)};
    const directory=path.join(root,'.work/prepared/example',info.fingerprint);
    await fs.mkdir(directory,{recursive:true});
    for(const item of manifest.files.filter(f=>f.kind!=='dependency'))await save(path.join(directory,item.hash),entries[item.archivePath]);
    await atomicJson(path.join(directory,'manifest.json'),manifest);
    return {...manifest,directory};
  };
  const change=async text=>save(path.join(root,target.path,'config/db-example.json'),text);
  return {base,root,mcRoot,gameDir,target,runtime,stage,change};
}
async function snapshot(root) {
  return Object.fromEntries(await Promise.all((await filesUnder(root)).map(async name=>[name,digest(await fs.readFile(path.join(root,name)))])));
}

export {setup,stopped,save,snapshot};

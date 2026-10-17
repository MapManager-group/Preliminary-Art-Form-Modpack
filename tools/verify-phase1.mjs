import os from 'node:os';
import {nativeWorkspace} from '../tests/pakku-fixture.mjs';
// Production checks are read-only; builds and launcher tests use isolated workspaces.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadWorkspace, filesUnder } from './lib/workspace.mjs';
import { checkTarget } from './lib/check.mjs';
import { build, inspectArchive } from './lib/build.mjs';
import { sha256, run, requireSuccess, pakku, bootstrap } from './lib/pakku.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Project-specific coverage: the production Target and all declared overrides remain unchanged.
{
  const root=repo;
  const w = await loadWorkspace(root);
  const snapshot = async () => {
    const files = requireSuccess(await run('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,capture:true})).stdout.split('\0').filter(Boolean);
    return Object.fromEntries(await Promise.all(files.map(async f=>{
      const bytes=await fs.readFile(path.join(root,f)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      return [f,bytes===null?null:sha256(bytes)];
    })));
  };
  const before = await snapshot();
  for (const target of w.targets) {
    await checkTarget(root,target);
    requireSuccess(await pakku(root,path.join(root,target.path),['ls'],{capture:true}));
    const {artifacts} = await build(root,target);
    for(const artifact of artifacts) {
      const entries = inspectArchive(artifact.bytes,artifact.kind);
      console.log(artifact.kind,Object.keys(entries));
      if (artifact.kind === 'modrinth') {
        const info=await checkTarget(root,target);
        for(const mapping of info.mapping) assert.equal(sha256(entries[mapping.archivePath]),sha256(await fs.readFile(path.join(info.dir,mapping.source))));
        const index=JSON.parse(new TextDecoder().decode(entries['modrinth.index.json']));
        assert.equal(index.dependencies.minecraft,info.lock.mc_versions[0]);
        assert.equal(index.files.length,info.lock.projects.length);
      }
    }
  }
  assert.deepEqual(await snapshot(),before,'check/build 改变了正式源文件（含未跟踪文件）');

}

const root = await fs.mkdtemp(path.join(os.tmpdir(),'DB 原生夹具-'));
for(const f of ['tools','toolchain.json','package.json'])await fs.cp(path.join(repo,f),path.join(root,f),{recursive:true});
await fs.cp(await fs.realpath(path.join(repo,'node_modules/fflate')),path.join(root,'node_modules/fflate'),{recursive:true});
await fs.mkdir(path.join(root,'.cache'));
await fs.copyFile(path.join(repo,'.cache/pakku-1.5.0.jar'),path.join(root,'.cache/pakku-1.5.0.jar'));
const w = await nativeWorkspace(root,[{id:'fixture-fabric',loader:'fabric',version:'0.16.14'},{id:'fixture-neoforge',loader:'neoforge',version:'21.1.172'}]);
const snapshot = async () => Object.fromEntries(await Promise.all((await filesUnder(path.join(root,'packs'))).map(async f=>[f,sha256(await fs.readFile(path.join(root,'packs',f)))])));
const before = await snapshot();
for (const target of w.targets) {
  await checkTarget(root,target);
  requireSuccess(await pakku(root,path.join(root,target.path),['ls'],{capture:true}));
  const {artifacts} = await build(root,target);
  for(const artifact of artifacts) {
    const entries = inspectArchive(artifact.bytes,artifact.kind);
    console.log(artifact.kind,Object.keys(entries));
    const prefix = artifact.kind === 'modrinth' ? 'overrides/' : '';
    assert.ok(entries[prefix+'config/db-example.json']);
    assert.ok(entries[prefix+'template-common.txt']);
    if(artifact.kind === 'modrinth') {
      assert.ok(entries['client-overrides/client-note.txt']);
      assert.ok(entries['client-overrides/config/db-client.json']);
      assert.ok(entries['server-overrides/server-note.txt']);
      assert.ok(entries['server-overrides/config/db-server.json']);
      const index=JSON.parse(new TextDecoder().decode(entries['modrinth.index.json']));
      assert.equal(index.dependencies.minecraft,'1.21.1');
      assert.equal(index.files.length,0);
    } else {
      assert.ok(entries['server-note.txt']);
      assert.ok(entries['config/db-server.json']);
      assert.ok(!entries['client-note.txt']);
      assert.ok(!entries['config/db-client.json']);
    }
  }
}
assert.deepEqual(await snapshot(),before,'check/build 改变了临时源文件');

const temp = await fs.mkdtemp(path.join(root,'.work','模板 复用-'));
for (const f of ['tools','packs','workspace.json','toolchain.json','package.json']) await fs.cp(path.join(root,f),path.join(temp,f),{recursive:true});
await fs.writeFile(path.join(temp,'workspace.json'),JSON.stringify({targets:[{...w.targets[0],id:'renamed-example'}]},null,2));
await fs.cp(await fs.realpath(path.join(repo,'node_modules/fflate')),path.join(temp,'node_modules/fflate'),{recursive:true});
await fs.mkdir(path.join(temp,'.cache'));
await fs.copyFile(path.join(root,'.cache/pakku-1.5.0.jar'),path.join(temp,'.cache/pakku-1.5.0.jar'));
await bootstrap(temp);
await bootstrap(temp,()=>{throw Error('重复下载')});
const cli = async (...args) => requireSuccess(await run(process.execPath,[path.join(temp,'tools/mp.mjs'),...args],{cwd:temp,capture:true}));
await cli('list'); // Sole target selection with no .local and no shared default.
await cli('pakku','--target','renamed-example','--','cfg','--name','Copied-Template');
await cli('check');
await cli('use','renamed-example');
await cli('build','--target','renamed-example');
const outputs = (await filesUnder(path.join(temp,'dist'))).filter(f=>/\.(mrpack|zip)$/.test(f));
assert.equal(outputs.length,2);
assert.ok(outputs.every(f=>f.includes('Copied-Template')));
console.log('PASS: 双目标原生读取、产物内容/侧别、源文件哈希不变、中文空格路径单目标复制/改名/构建、真实 bootstrap/复用');

console.log(`验证副本: ${root}`);

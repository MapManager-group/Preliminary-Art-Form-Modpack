// Explicit integration test: performs real Pakku work only in ignored preparation directories.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadWorkspace, filesUnder } from './lib/workspace.mjs';
import { checkTarget } from './lib/check.mjs';
import { build, inspectArchive } from './lib/build.mjs';
import { sha256, run, requireSuccess, pakku, bootstrap } from './lib/pakku.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = await loadWorkspace(root);
const snapshot = async () => {
  const files = requireSuccess(await run('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,capture:true})).stdout.split('\0').filter(Boolean);
  return Object.fromEntries(await Promise.all(files.map(async f=>[f,sha256(await fs.readFile(path.join(root,f)))])));
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
assert.deepEqual(await snapshot(),before,'check/build 改变了 tracked 文件');

const temp = await fs.mkdtemp(path.join(root,'.work','模板 复用-'));
for (const f of ['tools','packs','workspace.json','toolchain.json','package.json']) await fs.cp(path.join(root,f),path.join(temp,f),{recursive:true});
await fs.writeFile(path.join(temp,'workspace.json'),JSON.stringify({targets:[{...w.targets[0],id:'renamed-example'}]},null,2));
await bootstrap(temp);
await bootstrap(temp,()=>{throw Error('重复下载')});
const cli = async (...args) => requireSuccess(await run(process.execPath,[path.join(temp,'tools/mp.mjs'),...args],{cwd:temp,capture:true}));
await cli('list'); // Sole target selection with no .local and no shared default.
await cli('pakku','--target','renamed-example','--','cfg','--name','Copied-Template');
await cli('check');
await cli('use','renamed-example');
await cli('build','--target','renamed-example');
const outputs = (await filesUnder(path.join(temp,'dist'))).filter(f=>/\.(mrpack|zip)$/.test(f));
assert.equal(outputs.length,w.targets[0].artifacts.length);
assert.ok(outputs.every(f=>f.includes('Copied-Template')));
console.log('PASS: 正式目标原生读取、产物内容/侧别、tracked 哈希不变、中文空格路径单目标复制/改名/构建、真实 bootstrap/复用');

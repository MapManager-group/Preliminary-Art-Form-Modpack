import {nativeWorkspace} from '../tests/pakku-fixture.mjs';
// Local end-to-end verification; never contacts a release write endpoint or real game directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {run,requireSuccess,sha256} from './lib/pakku.mjs';
import {filesUnder} from './lib/workspace.mjs';
import {atomicJson} from './lib/runtime-fs.mjs';
import {ciPlan} from './ci.mjs';
import {publishDraft} from './release.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=await fs.mkdtemp(path.join(os.tmpdir(),'DB Phase4 模板 复用-')),root=path.join(base,'template');await fs.mkdir(root);
const execute=async(exe,args,cwd=root)=>requireSuccess(await run(exe,args,{cwd,capture:true}));
const cli=async(...args)=>execute(process.execPath,[path.join(root,'tools/mp.mjs'),...args]);
const git=async(...args)=>execute('git',args);
const snap=async dir=>Object.fromEntries(await Promise.all((await filesUnder(dir)).map(async n=>[n,sha256(await fs.readFile(path.join(dir,n)))])));
const original=await snap(path.join(repo,'tests/fixtures'));
try {
  for(const file of ['tools','tests','package.json','pnpm-lock.yaml','toolchain.json','.gitignore','.gitattributes','cz.config.cjs','commitlint.config.cjs'])await fs.cp(path.join(repo,file),path.join(root,file),{recursive:true});
  await fs.cp(await fs.realpath(path.join(repo,'node_modules/fflate')),path.join(root,'node_modules/fflate'),{recursive:true});
  await fs.mkdir(path.join(root,'.cache'));await fs.copyFile(path.join(repo,'.cache/pakku-1.5.0.jar'),path.join(root,'.cache/pakku-1.5.0.jar'));
  await nativeWorkspace(root);
  // New Target/name, native Pakku cfg, no handwritten lock and no source project migration.
  await fs.rename(path.join(root,'packs/fabric-1.21.1'),path.join(root,'packs/copied'));
  await atomicJson(path.join(root,'workspace.json'),{targets:[{id:'copied',path:'packs/copied',artifacts:['modrinth','serverpack']}]});
  await cli('pakku','--target','copied','--','cfg','--name','Copied-Phase4');
  await git('init');await git('config','user.name','Template Fixture');await git('config','user.email','fixture@example.invalid');await git('add','.');await git('commit','-m','test: copied template');
  const head=(await git('rev-parse','HEAD')).stdout.trim();
  // Invoke this verification through pnpm exec; doctor verifies the real inherited pnpm agent.
  await cli('doctor');
  await cli('check','--all');
  await execute(process.execPath,[path.join(root,'tools/ci.mjs'),'build','copied']);
  const reports=(await filesUnder(path.join(root,'dist/copied'))).filter(f=>f.endsWith('build-report.json'));assert.equal(reports.length,1);
  const directory=path.dirname(path.join(root,'dist/copied',reports[0])),report=JSON.parse(await fs.readFile(path.join(directory,'build-report.json')));
  assert.equal(report.dirty,false);assert.equal(report.git,head);assert.ok(report.artifacts.every(a=>a.name.startsWith('Copied-Phase4')));
  const pack=report.artifacts.find(a=>a.kind==='modrinth'),file=path.join(directory,pack.name);
  const plan=await publishDraft(root,{repo:'example/template',tag:'release/copied/v0.1.0',directory:path.relative(root,directory).split(path.sep).join('/')});assert.equal(plan.draft,true);
  for(const launcher of ['pcl2','hmcl']) {
    const launcherDir=path.join(base,launcher);await fs.cp(path.join(root,`tests/fixtures/launcher-${launcher}`),launcherDir,{recursive:true});
    const game=path.join(launcherDir,'versions/Example');await fs.writeFile(path.join(game,'options.txt'),'private fixture');
    await cli('bind',launcher,'--launcher',launcher,'--target','copied','--game-dir',game,'--confirm-game-dir');
    const before=await snap(root);await cli('apply',launcher,'--file',file,'--dry-run');assert.deepEqual(await snap(root),before);
    await cli('apply',launcher,'--file',file,'--sha256',pack.sha256,'--confirm','--stopped');
    const imported=await snap(game);assert.equal(imported['options.txt'],sha256(Buffer.from('private fixture')));
    await cli('deploy',launcher,'--stopped');assert.deepEqual(await snap(game),imported);
  }
  // Real Git diffs exercise planning, not a synthetic path list only.
  await fs.writeFile(path.join(root,'README.md'),'docs only');await git('add','README.md');await git('commit','-m','docs: fixture');
  const docsHead=(await git('rev-parse','HEAD')).stdout.trim();assert.deepEqual((await ciPlan(root,{before:head,after:docsHead},'push')).targets,[]);
  await fs.writeFile(path.join(root,'packs/copied/config/db-example.json'),'{}');await git('add','packs/copied/config/db-example.json');await git('commit','-m','test: changed target');
  const changedHead=(await git('rev-parse','HEAD')).stdout.trim();assert.deepEqual((await ciPlan(root,{before:docsHead,after:changedHead},'push')).targets,['copied']);
  // Deliberately break one Target: CI entry point must fail, never emit a successful artifact.
  await fs.writeFile(path.join(root,'packs/copied/pakku.json'),'{');
  const failed=await run(process.execPath,[path.join(root,'tools/ci.mjs'),'build','copied'],{cwd:root,capture:true});assert.notEqual(failed.code,0);
  assert.deepEqual(await snap(path.join(repo,'tests/fixtures')),original);
  console.log('PASS: 真实 Pakku + 复制/改名/单目标 doctor/check/干净 CI build，构建报告与 SHA；双假实例 Apply 与本地 Deploy 等价；模拟 Tag 草稿计划；真实 Git 文档/目标选择；故意损坏 Target 非零失败。未推送/未发布/未执行游戏。');
  console.log(`证据保留: ${base}`);
}catch(e){console.error(`失败证据保留: ${base}`);throw e;}

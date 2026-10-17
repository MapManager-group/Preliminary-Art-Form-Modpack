import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ciPlan, assertClean, affectedTargets, needsTests} from '../tools/ci.mjs';

test('CI 按构建输入筛选目标，测试与菜单变更只运行测试',()=>{
  const workspace={targets:['a','b'].map(id=>({id,path:`packs/${id}`}))};
  for(const file of ['README.md','AGENTS.md','docs/DEVELOPMENT.md','.vscode/tasks.json','LICENSE','.github/ISSUE_TEMPLATE/bug.yml']) {
    assert.deepEqual(affectedTargets(workspace,[file]),[],file);
    assert.equal(needsTests(workspace,[file]),false,file);
  }
  for(const file of ['ci.ps1','tests/menu.test.mjs','tests/fixtures/example.json','tools/verify-phase1.mjs','tools/lint-commits.mjs','cz.config.cjs','commitlint.config.cjs']) {
    assert.deepEqual(affectedTargets(workspace,[file]),[],file);
    assert.equal(needsTests(workspace,[file]),true,file);
  }
  for(const file of ['tools/lib/build.mjs','tools/mp.mjs','tools/ci.mjs','workspace.json','toolchain.json','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','.gitignore','.gitattributes','.github/workflows/ci.yml','.github/workflows/release.yml']) {
    assert.deepEqual(affectedTargets(workspace,[file]),['a','b'],file);
    assert.equal(needsTests(workspace,[file]),true,file);
  }
  assert.deepEqual(affectedTargets(workspace,['README.md','packs/a/.pakku/overrides/readme.md']),['a']);
  assert.equal(needsTests(workspace,['packs/a/pakku-lock.json']),true);
  assert.equal(needsTests(workspace,[],true),true);
});

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'DB CI 分支-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  git('init','-q','-b','custom/default');
  git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');
  for(const id of ['a','b']){await fs.mkdir(path.join(root,'packs',id),{recursive:true});await fs.writeFile(path.join(root,'packs',id,'.gitkeep'),'');}
  await fs.writeFile(path.join(root,'workspace.json'),JSON.stringify({targets:['a','b'].map(id=>({id,path:`packs/${id}`,artifacts:['modrinth']}))}));
  await fs.writeFile(path.join(root,'.gitignore'),'.cache/\n');
  const commit=()=>{git('add','.');git('commit','-qm','docs: fixture');return git('rev-parse','HEAD');};
  return {root,git,commit,base:commit()};
}
test('CI 首次推送、任意默认分支、普通推送、PR 与手动事件选择目标',async t=>{
  const f=await fixture(t);
  assert.deepEqual((await ciPlan(f.root,{before:'0'.repeat(40),after:f.base},'push')).targets,['a','b']);
  await fs.writeFile(path.join(f.root,'README.md'),'docs');const docs=f.commit();
  const docsPlan=await ciPlan(f.root,{before:f.base,after:docs},'push');
  assert.deepEqual(docsPlan.targets,[]);assert.equal(docsPlan.runTests,false);
  await fs.writeFile(path.join(f.root,'packs/a/config.json'),'{}');const changed=f.commit();
  assert.deepEqual((await ciPlan(f.root,{before:docs,after:changed},'push')).targets,['a']);
  assert.deepEqual((await ciPlan(f.root,{pull_request:{base:{sha:docs},head:{sha:changed}}},'pull_request')).targets,['a']);
  assert.deepEqual((await ciPlan(f.root,{},'workflow_dispatch')).targets,['a','b']);
  // A PR compares against the merge base, excluding unrelated changes on its base branch.
  f.git('checkout','-qb','other/base',docs);
  await fs.writeFile(path.join(f.root,'packs/b/config.json'),'{}');const other=f.commit();
  assert.deepEqual((await ciPlan(f.root,{pull_request:{base:{sha:other},head:{sha:changed}}},'pull_request')).targets,['a']);
});

test('CI 删除与跨目标移动覆盖旧路径，后续文档 push 不重复构建',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.root,'packs/a/config.json'),'{}');const added=f.commit();
  f.git('mv','packs/a/config.json','packs/b/config.json');const moved=f.commit();
  assert.deepEqual((await ciPlan(f.root,{before:added,after:moved},'push')).targets,['a','b']);
  await fs.unlink(path.join(f.root,'packs/b/config.json'));const deleted=f.commit();
  assert.deepEqual((await ciPlan(f.root,{before:moved,after:deleted},'push')).targets,['b']);
  await fs.writeFile(path.join(f.root,'README.md'),'new documentation');const docs=f.commit();
  const plan=await ciPlan(f.root,{before:deleted,after:docs},'push');
  assert.deepEqual(plan.targets,[]);assert.equal(plan.runTests,false);
  await fs.writeFile(path.join(f.root,'ci.ps1'),'# menu');const menu=f.commit();
  const menuPlan=await ciPlan(f.root,{before:docs,after:menu},'push');
  assert.deepEqual(menuPlan.targets,[]);assert.equal(menuPlan.runTests,true);
});
test('CI 干净检查发现未跟踪、已暂存、已跟踪修改，允许忽略缓存',async t=>{
  const f=await fixture(t);await assertClean(f.root);
  await fs.mkdir(path.join(f.root,'.cache'));await fs.writeFile(path.join(f.root,'.cache/tool'),'ignored');await assertClean(f.root);
  await fs.writeFile(path.join(f.root,'unexpected.txt'),'new');await assert.rejects(assertClean(f.root),/unexpected/);
  f.git('add','unexpected.txt');await assert.rejects(assertClean(f.root),/unexpected/);
  f.commit();await assertClean(f.root);
  await fs.appendFile(path.join(f.root,'unexpected.txt'),'changed');await assert.rejects(assertClean(f.root),/unexpected/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {lintCommits} from '../tools/lint-commits.mjs';
import {lintCiCommits} from '../tools/ci.mjs';
import {run,requireSuccess} from '../tools/lib/pakku.mjs';
const require=createRequire(import.meta.url);
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'DB commitlint-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=async(...args)=>requireSuccess(await run('git',args,{cwd:root,capture:true})).stdout.trim();
  await git('init','-q');await git('config','user.name','Fixture');await git('config','user.email','fixture@example.invalid');
  const original=await fs.readFile(new URL('../commitlint.config.cjs',import.meta.url),'utf8');
  await fs.writeFile(path.join(root,'commitlint.config.cjs'),original.replace('"@commitlint/config-conventional"',JSON.stringify(require.resolve('@commitlint/config-conventional'))));
  const commit=async message=>{await git('-c','core.hooksPath=','-c','commit.gpgsign=false','commit','--allow-empty','-qm',message);return git('rev-parse','HEAD');};
  return {root,git,commit};
}
test('无提交时明确报告未执行，非 Git 目录仍失败',async t=>{
  const f=await fixture(t),result=await lintCommits(f.root,[],{capture:true});
  assert.equal(result.skipped,true);assert.match(result.stdout,/尚无提交/);
  // A separate temp directory cannot inherit the fixture Git repository.
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'DB no-git-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await assert.rejects(lintCommits(outside,[],{capture:true}));
});
test('根提交支持默认检查和 CI 首次 Push；错误根提交不能漏检',async t=>{
  for(const message of ['🐛 fix(workspace): 根提交','invalid root message']) {
    const f=await fixture(t),head=await f.commit(message);
    for(const check of [()=>lintCommits(f.root,[],{capture:true}),()=>lintCiCommits(f.root,{head,capture:true})]) {
      if(message.startsWith('🐛'))assert.equal((await check()).code,0);
      else await assert.rejects(check());
    }
  }
});
test('普通历史默认仅查最新提交；CI 无基线包含根，显式区间保持排除 base',async t=>{
  const f=await fixture(t),base=await f.commit('invalid root message');
  const head=await f.commit('✅ test(workspace): 合法提交');
  assert.equal((await lintCommits(f.root,[],{capture:true})).code,0);
  await assert.rejects(lintCiCommits(f.root,{head,capture:true}));
  assert.equal((await lintCiCommits(f.root,{base,head,capture:true})).code,0);
  assert.equal((await lintCommits(f.root,['--','--from',base,'--to',head],{capture:true})).code,0);
  await f.commit('invalid later message');
  await assert.rejects(lintCommits(f.root,[],{capture:true}));
  assert.equal((await lintCiCommits(f.root,{base,head,capture:true})).code,0,'明确 head 不检查其后的提交');
});

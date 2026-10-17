import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const ci=fs.readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8').replaceAll('\r','');
const release=fs.readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8').replaceAll('\r','');

test('CI 保留 PR/任意分支入口、同仓库并发取消和 Fork 来源隔离',()=>{
  assert.match(ci,/\n  pull_request:\n/);
  assert.match(ci,/branches: \['\*\*'\]/);
  assert.doesNotMatch(ci,/pull_request_target|paths-ignore:|\n\s+paths:/);
  const group=ci.match(/^  group: (.+)$/m)?.[1];
  assert.equal(group,'ci-${{ github.workflow }}-${{ github.event.pull_request.head.repo.full_name || github.repository }}-${{ github.head_ref || github.ref_name }}');
  assert.match(ci,/cancel-in-progress: true/);
  assert.match(release,/cancel-in-progress: false/);
});

test('PR 工作流仅有读取权限，不持久化凭据；Actions 固定完整 SHA',()=>{
  assert.match(ci,/^permissions:\n  contents: read\n/m);
  assert.equal((ci.match(/permissions:/g)||[]).length,1);
  assert.doesNotMatch(ci,/secrets\.|contents: write|pull_request_target/);
  for(const workflow of [ci,release]) {
    const uses=[...workflow.matchAll(/uses: (\S+)([^\n]*)/g)];
    assert.ok(uses.length);
    for(const [,ref,comment] of uses) {
      assert.match(ref,/@[a-f0-9]{40}$/);assert.match(comment,/# v\d/);
    }
    assert.equal((workflow.match(/uses: actions\/checkout@/g)||[]).length,(workflow.match(/persist-credentials: false/g)||[]).length);
  }
  assert.match(ci,/test:\n    env:\n      MP_REQUIRE_MENU_TESTS: '1'\n    needs: plan\n    if: needs.plan.outputs.run_tests == 'true'/);
  assert.match(ci,/build:\n    needs: plan\n    if: needs.plan.outputs.has_targets == 'true'/);
  assert.match(ci,/if: always\(\)\n    needs: \[plan, test, build\]/);
});

const bash=process.platform==='win32'?path.join(process.env.ProgramFiles||'C:/Program Files','Git/bin/bash.exe'):'bash';
const available=spawnSync(bash,['--version'],{encoding:'utf8'}).status===0;
test('Required checks 执行真实门禁脚本，按计划跳过且拒绝失败、取消或意外跳过',{skip:available?false:'没有 Bash，无法执行工作流门禁脚本'},()=>{
  const required=ci.slice(ci.indexOf('\n  required:'));
  const script=required.split('        run: |\n')[1]?.split('\n').map(line=>line.replace(/^          /,'')).join('\n');
  assert.ok(script);
  const run=env=>spawnSync(bash,['--noprofile','--norc','-e','-c',script],{env:{...process.env,...env},encoding:'utf8'}).status;
  for(const [runTests,hasTargets] of [['false','false'],['true','false'],['true','true']]) {
    const env={PLAN:'success',TEST:runTests==='true'?'success':'skipped',BUILD:hasTargets==='true'?'success':'skipped',RUN_TESTS:runTests,HAS_TARGETS:hasTargets};
    assert.equal(run(env),0);
    for(const key of ['RUN_TESTS','HAS_TARGETS'])for(const value of ['','invalid'])assert.notEqual(run({...env,[key]:value}),0);
    for(const key of ['PLAN','TEST','BUILD']) {
      for(const value of ['failure','cancelled',env[key]==='success'?'skipped':'success'])assert.notEqual(run({...env,[key]:value}),0,`${key}=${value} ${JSON.stringify(env)}`);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {deploy,recover} from '../tools/lib/deploy.mjs';
import {setup,stopped,snapshot} from './sync-fixture.mjs';

const progressUrl=new URL('../tools/lib/progress.mjs',import.meta.url).href;
test('进度协议默认关闭，启用时仅使用 stderr，JSON 与失败退出码不变',()=>{
  const script=`import {progress,diagnostic} from ${JSON.stringify(progressUrl)}; progress('check','检查\\n阶段'); diagnostic('raw\\nlog'); console.log(JSON.stringify({ok:false})); console.error('原始错误'); process.exitCode=37;`;
  for(const mode of ['', 'jsonl']) {
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,MP_PROGRESS:mode}});
    assert.equal(result.status,37);assert.deepEqual(JSON.parse(result.stdout),{ok:false});
    const lines=result.stderr.trim().split('\n');assert.equal(lines.pop(),'原始错误');
    if(!mode)assert.deepEqual(lines,[]);
    else {
      const events=lines.map(line=>{assert.ok(line.startsWith('@mp:'));return JSON.parse(line.slice(4));});
      assert.deepEqual(events,[{schema:1,type:'progress',stage:'check',message:'检查\n阶段'},{schema:1,type:'diagnostic',text:'raw\nlog'}]);
    }
  }
});

test('同步阶段来自实际操作，预览不进入写入阶段，失败后保留恢复能力',async t=>{
  const f=await setup(t);await f.stage();
  const previous=process.env.MP_PROGRESS;process.env.MP_PROGRESS='jsonl';
  t.after(()=>{if(previous===undefined)delete process.env.MP_PROGRESS;else process.env.MP_PROGRESS=previous;});
  const events=[];
  t.mock.method(process.stderr,'write',value=>{if(String(value).startsWith('@mp:'))events.push(JSON.parse(String(value).slice(4)));return true;});
  const before=await snapshot(f.gameDir);
  await deploy(f.root,f.runtime,f.target,{...stopped,dryRun:true});
  assert.deepEqual(await snapshot(f.gameDir),before);
  assert.deepEqual(events.map(e=>e.stage),['deploy.check','deploy.plan']);
  events.length=0;
  await assert.rejects(deploy(f.root,f.runtime,f.target,{...stopped,beforeWrite:()=>{
    assert.ok(events.some(e=>e.stage==='deploy.backup'));
    assert.equal(events.at(-1).stage,'deploy.write');
    throw new Error('fixture write failure');
  }}),/fixture write failure/);
  assert.ok(events.findIndex(e=>e.stage==='deploy.download')<events.findIndex(e=>e.stage==='deploy.backup'));
  events.length=0;
  await recover(f.root,f.runtime,stopped);
  assert.deepEqual(events.map(e=>e.stage),['recover.check','recover.write']);
  assert.deepEqual(await snapshot(f.gameDir),before);
});

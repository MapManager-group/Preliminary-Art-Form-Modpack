import test from 'node:test';
import assert from 'node:assert/strict';
import lint from '@commitlint/lint';
import load from '@commitlint/load';
const config = await load({},{cwd:process.cwd()});
for(const [message,valid] of [
  ['✨ feat(workspace): 中文标题',true],
  ['fix(custom): 保留无 emoji 和自定义 scope',true],
  ['✨ feat(workspace)!: 更改接口\n\nBREAKING CHANGE: 更新调用方式',true],
  ['📝 docs: '+'长'.repeat(80),false],
  ['✨ invalid: 无效类型',false],
  ['不是 Conventional Commit',false],
]) test(`commitlint ${message.split('\n')[0].slice(0,35)}`,async()=>{
  const result=await lint(message,config.rules,{parserOpts:config.parserPreset.parserOpts});
  assert.equal(result.valid,valid,JSON.stringify(result.errors));
});

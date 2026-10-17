import test from 'node:test';
import assert from 'node:assert/strict';
import {probePowerShell,menuTestOptions,powerShellCandidates} from '../tools/lib/powershell.mjs';
const success=(version='7.4.13',path='/actual/pwsh')=>({status:0,stdout:JSON.stringify({version,path}),stderr:''});
test('PowerShell 探测区分缺失、不可执行别名、过旧版本和实际执行路径',()=>{
  assert.equal(probePowerShell({candidates:[]}).status,'missing');
  const broken=probePowerShell({candidates:['alias'],execute:()=>({status:null,error:new Error('EACCES')})});
  assert.equal(broken.status,'unusable');assert.equal(broken.attempts[0].path,'alias');
  assert.match(broken.message,/应用别名/);
  for(const version of ['5.1.1','7.2.20'])assert.equal(probePowerShell({candidates:['old'],execute:()=>success(version)}).status,'outdated');
  const result=probePowerShell({candidates:['alias','working'],execute:exe=>exe==='alias'?{status:1,stderr:'alias failed'}:success()});
  assert.equal(result.status,'ready');assert.equal(result.path,'/actual/pwsh');assert.equal(result.attempts.length,1);
  assert.equal(probePowerShell({candidates:['broken'],execute:()=>({status:0,stdout:'not json'})}).status,'unusable');
  assert.deepEqual(powerShellCandidates({MP_PWSH:'/explicit/pwsh',PATH:'/ignored'}),['/explicit/pwsh']);
});
test('菜单本地缺少环境可明确跳过；CI 必须失败；可用环境不跳过',()=>{
  const unavailable=probePowerShell({candidates:[]});
  assert.match(menuTestOptions(unavailable,false).skip,/未找到/);
  assert.throws(()=>menuTestOptions(unavailable,true),/必须实际执行/);
  assert.deepEqual(menuTestOptions({status:'ready'},true),{});
});

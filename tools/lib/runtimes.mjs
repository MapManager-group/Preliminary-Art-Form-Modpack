import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectLauncher, matchVersion, validateGameDir } from './launcher.mjs';
import { inspectTarget } from './check.mjs';
import { atomicJson, localPath, optionalJson, pathKey, runtimeKey, lockOperation, within } from './runtime-fs.mjs';

export async function runtimes(root) {
  const registry=await optionalJson(await localPath(root,'runtimes.json'),{schema:1,bindings:[]});
  if(registry.schema!==1||!Array.isArray(registry.bindings))throw new Error('Runtime 注册表无效');
  return registry;
}
export async function getRuntime(root,name) {
  const runtime=(await runtimes(root)).bindings.find(r=>r.id===name);
  if(!runtime)throw new Error(`Runtime 未绑定: ${name}`);
  const real=await validateGameDir(root,runtime.gameDir);
  if(runtimeKey(real)!==runtime.key || !runtime.confirmed)throw new Error('Runtime 路径身份变化或未确认');
  return runtime;
}
export async function verifyRuntime(root,runtime,target) {
  const real=await validateGameDir(root,runtime.gameDir);
  if(runtimeKey(real)!==runtime.key)throw new Error('Runtime 路径身份变化');
  const probe=await inspectLauncher(runtime);
  matchVersion(probe,(await inspectTarget(root,target)).lock);
  return probe;
}
export async function bindRuntime(root,target,name,options={}) {
  if(!/^[a-z0-9][a-z0-9_-]*$/.test(name))throw new Error('Runtime ID 仅允许小写字母、数字、下划线和横线');
  const gameDir=await validateGameDir(root,options.gameDir);
  const probe=await inspectLauncher({...options,gameDir});
  matchVersion(probe,(await inspectTarget(root,target)).lock);
  const existing=[];
  for(const folder of ['mods','config']) {
    const full=path.join(gameDir,folder);
    try {
      const stat=await fs.lstat(full);
      if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error(`Runtime ${folder} 不是普通目录`);
      existing.push(...(await fs.readdir(full)).map(f=>`${folder}/${f}`));
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const candidate={id:name,targetId:target.id,key:runtimeKey(gameDir),...probe,confirmed:options.confirmGameDir===true};
  const report={action:'bind',runtime:candidate,existing,notice:'现有文件不会自动接管；首次部署遇到同名文件将冲突'};
  options.report?.(report);
  if(options.dryRun)return report;
  if(!options.confirmGameDir)throw new Error('请先核对启动器实际游戏目录，再加 --confirm-game-dir 保存绑定');
  return lockOperation(runtimeKey(root),async()=>lockOperation(candidate.key,async()=>{
    const registry=await runtimes(root);
    if(registry.bindings.some(r=>r.id===name))throw new Error('Runtime 名称已存在；先 unbind');
    for(const r of registry.bindings) {
      if(r.key===candidate.key && (r.targetId!==target.id || pathKey(r.versionDir)!==pathKey(candidate.versionDir)))throw new Error('同一路径不能绑定不同 Target/版本');
      if(r.key!==candidate.key && (within(r.gameDir,gameDir)||within(gameDir,r.gameDir)))throw new Error('Runtime 路径不能相互嵌套');
    }
    const baseline=await optionalJson(await localPath(root,`runtimes/${candidate.key}/baseline.json`));
    if(baseline && baseline.targetId!==target.id)throw new Error('此目录保留了其他 Target 的成功基线，不能重新接管');
    registry.bindings.push(candidate);
    await atomicJson(await localPath(root,'runtimes.json'),registry);
    return report;
  }));
}
export async function unbindRuntime(root,name) {
  return lockOperation(runtimeKey(root),async()=>{
    const registry=await runtimes(root),runtime=registry.bindings.find(r=>r.id===name);
    if(!runtime)throw new Error('Runtime 未绑定');
    return lockOperation(runtime.key,async()=>{
      const journal=await optionalJson(await localPath(root,`runtimes/${runtime.key}/journal.json`));
      if(journal && !['committed','rolled-back'].includes(journal.status))throw new Error('存在未恢复操作，先 recover');
      registry.bindings=registry.bindings.filter(r=>r.id!==name);
      await atomicJson(await localPath(root,'runtimes.json'),registry);
      return {action:'unbind',id:name,retained:'游戏目录、成功基线、journal 和备份均保留'};
    });
  });
}

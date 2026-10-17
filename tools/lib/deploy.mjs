import { progress } from './progress.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safePath } from './workspace.mjs';
import { digest, prepare, readPrepared, sourceSnapshot, cachedBytes, obtainBytes } from './prepare.mjs';
import { fileInfo, runtimePath, localPath, atomicJson, optionalJson, lockOperation } from './runtime-fs.mjs';
import { verifyRuntime } from './runtimes.mjs';
import { assertStopped, probeProcesses } from './processes.mjs';

async function currentFile(gameDir,name,algorithms) {
  const info=await fileInfo(gameDir,name);
  if(!info)return null;
  const bytes=await fs.readFile(info.file);
  return {mode:info.mode,hashes:Object.fromEntries([...new Set(['sha256',...algorithms])].map(a=>[a,digest(bytes,a)]))};
}
const matches=(current,entry)=>current && entry && current.hashes[entry.algorithm]===entry.hash;
export function validateBaseline(baseline,runtime) {
  if(!baseline)return;
  if(baseline.schema!==1||baseline.key!==runtime.key||baseline.targetId!==runtime.targetId||!Array.isArray(baseline.files))throw new Error('成功基线身份不匹配');
  for(const file of baseline.files) {
    runtimePath(runtime,file.path);
    if(!['sha256','sha512'].includes(file.algorithm)||!new RegExp(`^[a-f0-9]{${file.algorithm==='sha512'?128:64}}$`).test(file.hash))throw new Error('成功基线哈希无效');
  }
}
export async function planDeployment(root,runtime,prepared,options={}) {
  progress('deploy.plan','正在比较实例文件并生成同步计划');
  const baseline=await optionalJson(await localPath(root,`runtimes/${runtime.key}/baseline.json`));
  validateBaseline(baseline,runtime);
  const old=new Map((baseline?.files??[]).map(f=>[f.path,f]));
  const desired=new Map(prepared.files.map(f=>[f.path,f]));
  const spelling=new Map();
  for(const name of [...old.keys(),...desired.keys()]) {
    runtimePath(runtime,name);
    const key=name.toLowerCase();
    if(spelling.has(key)&&spelling.get(key)!==name)throw new Error('仅大小写不同的部署路径冲突，请分步移除后添加');
    spelling.set(key,name);
  }
  const actions=[],conflicts=[],unchanged=[],adopt=[],downloads=[];
  for(const name of [...new Set([...old.keys(),...desired.keys()])].sort()) {
    const b=old.get(name),s=desired.get(name);
    const current=await currentFile(runtime.gameDir,name,[b?.algorithm,s?.algorithm].filter(Boolean));
    if(!b && s) {
      if(current) {
        if(options.adoptExisting && matches(current,s))adopt.push(name);
        else conflicts.push({path:name,reason:'未受管的同名文件；仅完全相同的内容可用 --adopt-existing 显式接管'});
      } else actions.push({path:name,type:'add',before:null,after:s});
    } else if(b && !s) {
      if(!current)unchanged.push(name);
      else if(matches(current,b))actions.push({path:name,type:'delete',before:current.hashes.sha256,after:null});
      else conflicts.push({path:name,reason:'源已删除，但实例已有本地修改'});
    } else if(!current && /^mods\/.+\.jar$/i.test(name) &&
      [b,s].every(file=>['dependency','exported-dependency'].includes(file.kind))) {
      // Missing managed JARs can be recreated; config deletions remain conflicts.
      // Keep the existing add transaction so recovery restores the pre-deploy absence.
      actions.push({path:name,type:'add',before:null,after:s,reason:'受管依赖缺失，待恢复'});
    } else if(matches(current,s))unchanged.push(name);
    else if(matches(current,b))actions.push({path:name,type:'update',before:current.hashes.sha256,after:s});
    else conflicts.push({path:name,reason:'实例偏离上次成功基线（修改或删除），保留并阻止部署'});
    if(current && actions.some(a=>a.path===name) && !(current.mode & 0o200))conflicts.push({path:name,reason:'文件只读'});
  }
  for(const action of actions.filter(a=>a.after?.kind==='dependency')) {
    if(!(await cachedBytes(root,prepared,action.after)))downloads.push({path:action.path,bytes:action.after.size});
  }
  const preserved=[];
  // Inventory only user-relevant content roots; never traverse saves/accounts/logs.
  async function inventory(prefix) {
    const directory=await safePath(runtime.gameDir,prefix);
    let entries;
    try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
    for(const entry of entries) {
      const name=`${prefix}/${entry.name}`;
      if(entry.isDirectory())await inventory(name);
      else if(!old.has(name)&&!desired.has(name))preserved.push(name);
    }
  }
  for(const prefix of ['mods','config','resourcepacks','shaderpacks','kubejs','scripts','defaultconfigs'])await inventory(prefix);
  return {runtime:runtime.id,key:runtime.key,targetId:runtime.targetId,source:prepared.fingerprint,actions,conflicts,unchanged,adopt,downloads,preserved:preserved.sort(),privateFiles:'存档、日志和账户不纳管；未声明的个人设置不遍历、不接管',baseline};
}
function publicPlan(plan) { const {baseline,...report}=plan;return report; }
async function journalPath(root,runtime) { return localPath(root,`runtimes/${runtime.key}/journal.json`); }
export async function checkJournal(root,runtime) {
  const journal=await optionalJson(await journalPath(root,runtime));
  if(journal && !['committed','rolled-back'].includes(journal.status))throw new Error('存在未完成部署，先执行 mp recover <runtime> --stopped');
}
export async function deploy(root,runtime,target,options={}) {
  progress('deploy.check','正在检查 Target 和 Runtime');
  await verifyRuntime(root,runtime,target);
  if(options.dryRun) {
    await checkJournal(root,runtime);
    const prepared=options.prepared??await readPrepared(root,target);
    const plan=await planDeployment(root,runtime,prepared,options);
    const process=await (options.probe ?? probeProcesses)(runtime.gameDir);
    options.report?.({...publicPlan(plan),process,dryRun:true});
    if(plan.conflicts.length || process.status==='running')throw new Error('部署计划存在冲突或游戏正在运行');
    return publicPlan(plan);
  }
  return lockOperation(runtime.key,async()=>{
    await checkJournal(root,runtime);
    await assertStopped(runtime.gameDir,options.stopped,options.probe);
    const prepared=options.prepared??await prepare(root,target,options);
    let plan=await planDeployment(root,runtime,prepared,options);
    options.report?.(publicPlan(plan));
    if(plan.conflicts.length)throw new Error('存在冲突，未修改任何 Runtime 文件');
    progress('deploy.download','正在准备需要同步的文件');
    const staged=new Map();
    for(const action of plan.actions.filter(a=>a.after))staged.set(action.path,await obtainBytes(root,prepared,action.after,options.download));
    // Downloads and prompts may take time: recheck both sides and game status before writing.
    await verifyRuntime(root,runtime,target);
    await assertStopped(runtime.gameDir,options.stopped,options.probe);
    if(options.verifyPrepared)await options.verifyPrepared();
    else if((await sourceSnapshot(root,target)).fingerprint!==prepared.fingerprint)throw new Error('准备期间源已变化，拒绝应用');
    const again=await planDeployment(root,runtime,prepared,options);
    if(JSON.stringify({...again,downloads:[]})!==JSON.stringify({...plan,downloads:[]}))throw new Error('准备期间 Runtime/基线变化，请重试');
    const before=plan.baseline;
    // Keep configuration B independently of disposable .work; never copy dependency JARs here.
    for(const file of prepared.files.filter(f=>f.kind==='override')) {
      const bytes=await obtainBytes(root,prepared,file);
      const dest=await localPath(root,`runtimes/${runtime.key}/blobs/${file.hash}`);
      await fs.mkdir(path.dirname(dest),{recursive:true});
      await fs.writeFile(dest,bytes);
    }
    const baseline={schema:1,key:runtime.key,targetId:target.id,source:{kind:'local',fingerprint:prepared.fingerprint,version:prepared.version,git:prepared.git,dirty:prepared.dirty,pakku:prepared.pakku,lockHash:prepared.lockHash,configHash:prepared.configHash,...prepared.provenance},files:prepared.files};
    if(!plan.actions.length && !plan.adopt.length && JSON.stringify(before)===JSON.stringify(baseline))return {unchanged:true};
    const id=randomUUID();
    progress('deploy.backup','正在备份受影响文件');
    const transaction=await localPath(root,`runtimes/${runtime.key}/transactions/${id}`);
    await fs.mkdir(transaction,{recursive:true});
    const changes=[];
    for(const action of plan.actions) {
      const file=await safePath(runtime.gameDir,action.path);
      if(action.before) {
        const bytes=await fs.readFile(file);
        if(digest(bytes)!==action.before)throw new Error('备份前实例文件变化');
        await fs.writeFile(path.join(transaction,action.before),bytes,{flag:'w'});
      }
      const temp=action.after?`${action.path}.mp-${id}.tmp`:null;
      changes.push({...action,temp,afterSha256:action.after?digest(staged.get(action.path)):null});
    }
    const journal={schema:1,id,key:runtime.key,targetId:target.id,status:'applying',beforeBaseline:before,changes,completed:[]};
    await atomicJson(await journalPath(root,runtime),journal);
    try {
      progress('deploy.write','正在应用文件变化');
      for(const change of changes) {
        await assertStopped(runtime.gameDir,options.stopped,options.probe);
        const now=await fileInfo(runtime.gameDir,change.path);
        if((now?.hash??null)!==change.before)throw new Error(`写入前实例变化: ${change.path}`);
        options.beforeWrite && await options.beforeWrite(change,journal.completed.length);
        const dest=await safePath(runtime.gameDir,change.path);
        if(change.after) {
          await fs.mkdir(path.dirname(dest),{recursive:true});
          const tmp=await safePath(runtime.gameDir,change.temp);
          await fs.writeFile(tmp,staged.get(change.path),{flag:'wx'});
          await safePath(runtime.gameDir,change.path);
          await fs.rename(tmp,dest);
        } else await fs.unlink(dest);
        journal.completed.push(change.path);
        await atomicJson(await journalPath(root,runtime),journal);
      }
      for(const file of baseline.files)if(!matches(await currentFile(runtime.gameDir,file.path,[file.algorithm]),file))throw new Error(`写后校验失败: ${file.path}`);
      await atomicJson(await localPath(root,`runtimes/${runtime.key}/baseline.json`),baseline);
      journal.status='committed';await atomicJson(await journalPath(root,runtime),journal);
      return {applied:changes.length,adopted:plan.adopt.length};
    }catch(e) {
      journal.status='failed';journal.error=e.message;
      await atomicJson(await journalPath(root,runtime),journal);
      throw new Error(`部署部分应用或中断，文件和基线需要恢复；运行 mp recover ${runtime.id} --stopped。${e.message}`);
    }
  });
}
export async function recover(root,runtime,options={}) {
  progress('recover.check','正在检查未完成的同步与备份');
  return lockOperation(runtime.key,async()=>{
    await assertStopped(runtime.gameDir,options.stopped,options.probe);
    const journal=await optionalJson(await journalPath(root,runtime));
    if(!journal || ['committed','rolled-back'].includes(journal.status))return {recovery:'无需恢复'};
    if(journal.schema!==1||journal.key!==runtime.key||journal.targetId!==runtime.targetId||!/^[a-f0-9-]{36}$/.test(journal.id))throw new Error('journal 身份无效');
    const transaction=await localPath(root,`runtimes/${runtime.key}/transactions/${journal.id}`);
    // Preflight ALL files before rollback. Never overwrite newer game/user edits.
    for(const change of journal.changes) {
      runtimePath(runtime,change.path);
      if(!['add','update','delete'].includes(change.type) || [change.before,change.afterSha256].some(h=>h!==null&&!/^[a-f0-9]{64}$/.test(h)))throw new Error('journal 变更或哈希无效');
      const current=await fileInfo(runtime.gameDir,change.path);
      if(![change.before,change.afterSha256].includes(current?.hash??null))throw new Error(`恢复冲突，保留当前文件: ${change.path}`);
      if(change.before) {
        if(!/^[a-f0-9]{64}$/.test(change.before))throw new Error('备份哈希无效');
        if(digest(await fs.readFile(await safePath(transaction,change.before)))!==change.before)throw new Error('备份损坏，拒绝恢复');
      }
      if(change.temp) {
        if(change.temp!==`${change.path}.mp-${journal.id}.tmp`)throw new Error('journal 临时路径无效');
        const temp=await fileInfo(runtime.gameDir,change.temp);
        if(temp && temp.hash!==change.afterSha256)throw new Error('临时文件已变化，拒绝删除');
      }
    }
    options.report?.({action:'recover',files:journal.changes.map(c=>c.path)});
    progress('recover.write','正在恢复未完成的同步');
    journal.status='rolling-back';await atomicJson(await journalPath(root,runtime),journal);
    for(const change of [...journal.changes].reverse()) {
      await assertStopped(runtime.gameDir,options.stopped,options.probe);
      const current=await fileInfo(runtime.gameDir,change.path);
      if(![change.before,change.afterSha256].includes(current?.hash??null))throw new Error('恢复期间实例文件变化');
      const dest=await safePath(runtime.gameDir,change.path);
      if((current?.hash??null)!==change.before) {
        if(change.before) {
          const restore=`${change.path}.mp-${journal.id}.restore`;
          const tmp=await safePath(runtime.gameDir,restore);
          // Recovery staging may survive a previous recovery interruption; validate before reusing.
          const existing=await fileInfo(runtime.gameDir,restore);
          if(existing && existing.hash!==change.before)throw new Error('恢复临时文件冲突');
          if(!existing)await fs.writeFile(tmp,await fs.readFile(path.join(transaction,change.before)),{flag:'wx'});
          await fs.rename(tmp,dest);
        }else if(current)await fs.unlink(dest);
      }
      if(change.temp) {const temp=await safePath(runtime.gameDir,change.temp);await fs.rm(temp,{force:true});}
    }
    const baselineFile=await localPath(root,`runtimes/${runtime.key}/baseline.json`);
    if(journal.beforeBaseline)await atomicJson(baselineFile,journal.beforeBaseline);else await fs.rm(baselineFile,{force:true});
    journal.status='rolled-back';await atomicJson(await journalPath(root,runtime),journal);
    return {recovery:'已恢复到部署前文件与基线；备份保留，空目录不自动删除'};
  });
}

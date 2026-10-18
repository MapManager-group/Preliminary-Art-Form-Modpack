import {checkImportIntegrity,checkImportConfig,candidateHash} from './import-integrity.mjs';
import { progress } from './progress.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safePath, readJson } from './workspace.mjs';
import { sourceSnapshot, digest, readPrepared, obtainBytes } from './prepare.mjs';
import { checkTarget } from './check.mjs';
import { pakku, requireSuccess } from './pakku.mjs';
import { changes, sourceBytes, textDiff } from './changes.mjs';
import { replaceSource } from './collect.mjs';
import { localPath, atomicJson, optionalJson, lockOperation, runtimeKey, fileInfo, managedPath } from './runtime-fs.mjs';
import { checkJournal, validateBaseline } from './deploy.mjs';
import { assertStopped } from './processes.mjs';
import { verifyRuntime, getRuntime } from './runtimes.mjs';

export async function reviewDependencies(root,runtime,target,options={}) {
  const report=await changes(root,runtime,target);options.report?.(report);
  if(!['add','remove'].includes(options.operation)||! /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.project??''))throw new Error('需要 --operation add|remove --project <已人工核实的 ID/slug>；不猜测本地 JAR 来源');
  const info=await sourceSnapshot(root,target),id=randomUUID();
  const projectPath=`.work/candidates/${id}/project`,dir=await safePath(root,projectPath);
  await fs.mkdir(dir,{recursive:true});
  for(const name of info.source) {const dest=await safePath(dir,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(info.dir,name),dest);}
  const args=options.operation==='add'?['--yes','add',options.project]:['--yes','rm','--no-deps',options.project];
  requireSuccess(await pakku(root,dir,args,{...options,capture:true}));
  await checkTarget(root,{...target,path:projectPath},options);
  const candidate=await sourceSnapshot(root,{...target,path:projectPath});
  if(JSON.stringify(Object.entries(candidate.hashes).filter(([n])=>n!=='pakku-lock.json'))!==JSON.stringify(Object.entries(info.hashes).filter(([n])=>n!=='pakku-lock.json')))throw new Error('Pakku 修改了锁文件之外的源，请人工审查副本');
  if(candidate.hashes['pakku-lock.json']===info.hashes['pakku-lock.json'])throw new Error('Pakku 未产生锁文件变化；未生成可接受候选');
  const before=await sourceBytes(info.dir,'pakku-lock.json'),after=await sourceBytes(dir,'pakku-lock.json');
  const record={schema:1,id,targetId:target.id,sourceFingerprint:info.fingerprint,operation:options.operation,project:options.project,hash:digest(after),before:digest(before)};
  await atomicJson(await safePath(root,`.work/candidates/${id}/review.json`),record);
  return {...record,diff:textDiff(before,after),projectPath,notice:'仅生成完整 Pakku 工程副本。人工核实来源、许可及所有依赖变动；不保证与未知本地 JAR 相同。'};
}
export async function acceptDependencies(root,target,options={}) {
  progress('candidate.check','正在复核候选、正式源与导入文件');
  if(!/^[a-f0-9-]{36}$/.test(options.candidate??'')||!options.confirm||!/^[a-f0-9]{64}$/.test(options.acceptHash??''))throw new Error('需要 --candidate <id> --accept-hash <审查的 SHA256> --confirm');
  return lockOperation(runtimeKey(await safePath(root,target.path)),async()=>{
    const base=`.work/candidates/${options.candidate}`,record=await readJson(await safePath(root,`${base}/review.json`));
    await assertNoPendingDependencyWrite(root,target);
    const info=await sourceSnapshot(root,target);
    if(record.schema!==1||record.id!==options.candidate||record.targetId!==target.id||record.sourceFingerprint!==info.fingerprint)throw new Error('候选身份不符或正式源已变化，重新审查');
    const candidateTarget={...target,path:`${base}/project`};
    await checkTarget(root,candidateTarget,options);
    const candidate=await sourceSnapshot(root,candidateTarget);
    const withConfig=record.operation==='import'&&record.importSource&&typeof record.configHash==='string';
    if(record.importSource) {checkImportConfig(info.config,candidate.config);checkImportIntegrity(info.lock,candidate.lock);}
    for(const name of new Set([...info.source,...candidate.source]))if(name!=='pakku-lock.json' && !(withConfig&&name==='pakku.json') && info.hashes[name]!==candidate.hashes[name])throw new Error('候选含锁文件以外变化，拒绝接受');
    const after=await sourceBytes(candidate.dir,'pakku-lock.json');
    const configAfter=withConfig?await sourceBytes(candidate.dir,'pakku.json'):undefined;
    if((withConfig&&digest(configAfter)!==record.configHash)||candidateHash(after,configAfter)!==record.hash||record.hash!==options.acceptHash)throw new Error('候选锁文件哈希已变化');
    const verifyImportSource=async()=>{if(record.importSource) {
      const input=record.importSource,runtime=await getRuntime(root,input.runtime);
      if(runtime.key!==input.key||runtime.targetId!==target.id)throw new Error('导入来源绑定已变化');
      await verifyRuntime(root,runtime,target);
      const files=input.files??[{file:input.file,hash:input.hash}];
      if(!Array.isArray(files)||!files.length)throw new Error('导入来源列表无效');
      for(const file of files)if((await fileInfo(runtime.gameDir,file.file))?.hash!==file.hash)throw new Error(`导入来源 JAR 已变化，重新识别: ${file.file}`);
    }};
    await verifyImportSource();
    if((await sourceSnapshot(root,target)).fingerprint!==info.fingerprint)throw new Error('验证期间源已变化');
    const writeOptions={...options,beforeWrite:async()=>{
      await options.beforeWrite?.();
      await verifyImportSource();
      if((await sourceSnapshot(root,target)).fingerprint!==info.fingerprint)throw new Error('写入前源已变化');
    }};
    const metadata={operation:'accept-dependencies',candidate:record.id};
    if(withConfig)return replaceDependencySources(root,target,[
      {name:'pakku.json',before:await sourceBytes(info.dir,'pakku.json'),after:configAfter},
      {name:'pakku-lock.json',before:await sourceBytes(info.dir,'pakku-lock.json'),after},
    ],metadata,writeOptions);
    return replaceSource(root,target,'pakku-lock.json',await sourceBytes(info.dir,'pakku-lock.json'),after,metadata,writeOptions);
  });
}

export async function assertNoPendingDependencyWrite(root,target) {
  const collection=await localPath(root,'collect');
  for(const entry of await fs.readdir(collection).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
    const previous=await optionalJson(await localPath(root,`collect/${entry}/record.json`));
    if(previous?.targetId===target.id&&previous.files&&['applying','rollback-failed'].includes(previous.status))throw new Error(`存在未完成的源写入，请先检查备份 .local/collect/${entry}`);
  }
}

// A config + lock acceptance has one backup and one transaction. Individual renames
// are atomic; errors roll back our writes only. An interrupted transaction retains
// both originals and blocks another paired write until its backup is inspected.
async function replaceDependencySources(root,target,files,metadata,options) {
  const dir=await safePath(root,target.path);
  await assertNoPendingDependencyWrite(root,target);
  for(const file of files) {
    if(digest(await sourceBytes(dir,file.name))!==digest(file.before))throw new Error('源文件已变化');
    if(!((await fs.stat(await safePath(dir,file.name))).mode&0o200))throw new Error('源文件只读');
  }
  const id=randomUUID(),base=await localPath(root,`collect/${id}`);
  await fs.mkdir(path.join(base,'before'),{recursive:true});await fs.mkdir(path.join(base,'after'));
  const record={schema:1,targetId:target.id,...metadata,status:'prepared',files:files.map(f=>({path:f.name,before:digest(f.before),after:digest(f.after)}))};
  for(const file of files) {
    await fs.writeFile(path.join(base,'before',file.name),file.before,{flag:'wx'});
    await fs.writeFile(path.join(base,'after',file.name),file.after,{flag:'wx'});
  }
  const journal=path.join(base,'record.json');await atomicJson(journal,record);
  await options.beforeWrite();
  for(const file of files)if(digest(await sourceBytes(dir,file.name))!==digest(file.before))throw new Error('写入前源文件已变化');
  const written=[];
  const replace=async(file,bytes)=>{
    const temp=await safePath(dir,`${file.name}.collect-${id}.tmp`);
    try {await fs.writeFile(temp,bytes,{flag:'wx'});await fs.rename(temp,await safePath(dir,file.name));}
    finally {await fs.rm(temp,{force:true});}
  };
  record.status='applying';await atomicJson(journal,record);
  try {
    progress('source.write','正在写入已确认的 Pakku 配置与锁文件');
    for(const file of files) {
      await options.beforeFileWrite?.(file.name,written.length);
      if(digest(await sourceBytes(dir,file.name))!==digest(file.before))throw new Error('写入前源文件已变化');
      await replace(file,file.after);written.push(file);
    }
    for(const file of files)if(digest(await sourceBytes(dir,file.name))!==digest(file.after))throw new Error('源写后校验失败');
    record.status='committed';await atomicJson(journal,record);
  } catch(error) {
    try {
      for(const file of written.reverse()) {
        if(digest(await sourceBytes(dir,file.name))!==digest(file.after))throw new Error('源被外部修改，未覆盖');
        await replace(file,file.before);
      }
      record.status='rolled-back';await atomicJson(journal,record);
    } catch(rollback) {
      record.status='rollback-failed';await atomicJson(journal,record);
      throw new Error(`${error.message}；回滚失败：${rollback.message}，检查备份 .local/collect/${id}`);
    }
    throw error;
  }
  return {collected:files.map(f=>f.name).join(' / '),files:record.files,backup:`.local/collect/${id}`};
}

// Restore the deployed formal combination only when its lock still is the current source lock.
// Use the existing deployment journal format, so interrupted repairs use mp recover.
export async function restoreDependencies(root,runtime,target,options={}) {
  await verifyRuntime(root,runtime,target);await checkJournal(root,runtime);
  const makePlan=async()=>{
    const info=await sourceSnapshot(root,target);
    const baseline=await optionalJson(await localPath(root,`runtimes/${runtime.key}/baseline.json`));
    validateBaseline(baseline,runtime);
    if(!baseline || baseline.source.lockHash!==info.hashes['pakku-lock.json'])throw new Error('需已部署且与当前锁文件一致的基线；源依赖已变化时先审查 Deploy');
    const prepared=await readPrepared(root,target,info),expected=baseline.files.filter(f=>f.kind!=='override');
    if(JSON.stringify(expected)!==JSON.stringify(prepared.files.filter(f=>f.kind!=='override')))throw new Error('当前导出依赖与基线不一致；先审查 Deploy');
    const actions=[];
    for(const file of expected) {
      const now=await fileInfo(runtime.gameDir,file.path);
      if(now && digest(await fs.readFile(now.file),file.algorithm)===file.hash)continue;
      if(now && !(now.mode&0o200))throw new Error('依赖文件只读');
      actions.push({path:file.path,type:now?'update':'add',before:now?.hash??null,after:file});
    }
    if(options.file) {
      managedPath(options.file);
      if(!/^mods\/.+\.jar(?:\.(disabled|disable|bak))?$/i.test(options.file)||baseline.files.some(f=>f.path.toLowerCase()===options.file.toLowerCase()))throw new Error('--file 仅选择一个未受管 JAR/禁用 JAR 移入备份');
      const now=await fileInfo(runtime.gameDir,options.file);
      if(!now)throw new Error('选中的额外 JAR 不存在');
      actions.push({path:options.file,type:'delete',before:now.hash,after:null});
    }
    return {fingerprint:info.fingerprint,baseline,prepared,actions};
  };
  const initial=await makePlan();
  options.report?.({operation:'restore-deps',actions:initial.actions,notice:'其他未知 JAR 与所有配置保持原样；可用 --file 点选一个额外 JAR 移入备份'});
  if(!options.confirm)return {preview:true,actions:initial.actions};
  return lockOperation(runtime.key,async()=>{
    await checkJournal(root,runtime);await assertStopped(runtime.gameDir,options.stopped,options.probe);
    const staged=new Map();
    for(const action of initial.actions.filter(a=>a.after))staged.set(action.path,await obtainBytes(root,initial.prepared,action.after,options.download));
    if(JSON.stringify(await makePlan())!==JSON.stringify(initial))throw new Error('审查/下载期间源或实例变化');
    if(!initial.actions.length)return {unchanged:true};
    const id=randomUUID(),base=await localPath(root,`runtimes/${runtime.key}/transactions/${id}`);
    await fs.mkdir(base,{recursive:true});
    const changes=[];
    for(const action of initial.actions) {
      if(action.before) {
        const bytes=await fs.readFile(await safePath(runtime.gameDir,action.path));
        if(digest(bytes)!==action.before)throw new Error('备份前实例变化');
        await fs.writeFile(path.join(base,action.before),bytes);
      }
      changes.push({...action,temp:action.after?`${action.path}.mp-${id}.tmp`:null,afterSha256:action.after?digest(staged.get(action.path)):null});
    }
    const journal={schema:1,id,key:runtime.key,targetId:target.id,status:'applying',beforeBaseline:initial.baseline,changes,completed:[],operation:'restore-deps'};
    const journalFile=await localPath(root,`runtimes/${runtime.key}/journal.json`);
    await atomicJson(journalFile,journal);
    try {
      for(const change of changes) {
        await assertStopped(runtime.gameDir,options.stopped,options.probe);
        if((await fileInfo(runtime.gameDir,change.path))?.hash!==(change.before??undefined))throw new Error('写入前实例变化');
        options.beforeWrite && await options.beforeWrite(change,journal.completed.length);
        const dest=await safePath(runtime.gameDir,change.path);
        if(change.after) {
          await fs.mkdir(path.dirname(dest),{recursive:true});
          const tmp=await safePath(runtime.gameDir,change.temp);await fs.writeFile(tmp,staged.get(change.path),{flag:'wx'});await fs.rename(tmp,dest);
        } else await fs.unlink(dest);
        journal.completed.push(change.path);await atomicJson(journalFile,journal);
      }
      for(const change of changes)if(((await fileInfo(runtime.gameDir,change.path))?.hash??null)!==change.afterSha256)throw new Error('恢复依赖写后校验失败');
      journal.status='committed';await atomicJson(journalFile,journal);
      return {restored:changes.length,backup:`.local/runtimes/${runtime.key}/transactions/${id}`};
    }catch(e){journal.status='failed';await atomicJson(journalFile,journal);throw new Error(`恢复依赖中断，先 mp recover ${runtime.id} --stopped；${e.message}`);}
  });
}

import { publicContent } from './content-policy.mjs';
import { progress } from './progress.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safePath } from './workspace.mjs';
import { changes, sourceBytes, textContent } from './changes.mjs';
import { sourceSnapshot, digest } from './prepare.mjs';
import { fileInfo, lockOperation, runtimeKey, localPath, atomicJson, managedPath } from './runtime-fs.mjs';
import { assertStopped } from './processes.mjs';

// Single-file acceptance keeps each approval concrete and each source replacement atomic.
// Backups are retained even if the process dies after rename; Git is never staged here.
export async function replaceSource(root,target,name,before,after,metadata,options={}) {
  progress('source.backup','正在校验并备份选中的源文件');
  const dir=await safePath(root,target.path),dest=await safePath(dir,name);
  const original=await sourceBytes(dir,name);
  if((original?digest(original):null)!==(before?digest(before):null))throw new Error('源文件已变化');
  if(before) {const stat=await fs.stat(dest);if(!(stat.mode&0o200))throw new Error('源文件只读');}
  const id=randomUUID(),base=await localPath(root,`collect/${id}`);
  await fs.mkdir(base,{recursive:true});
  if(before)await fs.writeFile(path.join(base,'before'),before,{flag:'wx'});
  if(after)await fs.writeFile(path.join(base,'after'),after,{flag:'wx'});
  const record={schema:1,targetId:target.id,path:name,before:before?digest(before):null,after:after?digest(after):null,status:'prepared',...metadata};
  await atomicJson(path.join(base,'record.json'),record);
  options.beforeWrite && await options.beforeWrite();
  const now=await sourceBytes(dir,name);
  if((now?digest(now):null)!==record.before)throw new Error('写入前源文件已变化');
  progress('source.write','正在写入已确认的源文件');
  if(after) {
    await fs.mkdir(path.dirname(dest),{recursive:true});
    const temp=await safePath(dir,`${name}.collect-${id}.tmp`);
    try{await fs.writeFile(temp,after,{flag:'wx'});await safePath(dir,name);await fs.rename(temp,dest);}
    finally{await fs.rm(temp,{force:true});}
  } else await fs.unlink(dest);
  record.status='committed';await atomicJson(path.join(base,'record.json'),record);
  return {collected:name,before:record.before,after:record.after,backup:`.local/collect/${id}`};
}
export async function collect(root,runtime,target,options={}) {
  progress('collect.compare','正在比较配置与源文件');
  const report=await changes(root,runtime,target,{diff:true});options.report?.(report);
  if(!options.confirm)return {preview:true,report};
  if(!options.file)throw new Error('回收需要 --file 明确选择一个文件；不提供全部回收');
  managedPath(options.file);
  return lockOperation(runtimeKey(await safePath(root,target.path)),()=>lockOperation(runtime.key,async()=>{
    await assertStopped(runtime.gameDir,options.stopped,options.probe);
    const current=await changes(root,runtime,target,{diff:true});
    if(JSON.stringify(current)!==JSON.stringify(report))throw new Error('审查期间源或实例变化，请重新查看');
    const item=current.managed.find(f=>f.path===options.file),candidate=current.candidates.find(f=>f.path===options.file);
    let source=item?.source;
    if(item) {
      if(item.state!=='runtime-only'||!item.baseline)throw new Error('只允许回收仅实例变化的已受管文件；冲突需人工处理');
      if(options.source && options.source!==source)throw new Error('不得改变已受管来源映射');
      if(item.runtime===null && !options.delete)throw new Error('回收删除需额外 --delete');
    } else if(candidate) {
      source=options.source;
      if(!['.pakku/overrides/','.pakku/client-overrides/'].some(p=>source===p+options.file))throw new Error('新 config 候选必须 --source .pakku/client-overrides/<原路径> 或 .pakku/overrides/<原路径>');
      if(candidate.binary)throw new Error('二进制新候选需独立许可/内容审查，不自动回收');
    } else throw new Error('文件不可回收（冲突、依赖或私人文件）');
    if(/\.(jar|zip|mrpack)$/i.test(source))throw new Error('不回收 JAR 或归档；请在源工程手动替换');
    const info=await sourceSnapshot(root,target);
    if(candidate && info.mapping.some(m=>m.destination.toLowerCase()===options.file.toLowerCase()))throw new Error('新候选与现有侧别映射重叠，需人工选择');
    const before=await sourceBytes(info.dir,source);
    if(candidate && before)throw new Error('候选来源已存在');
    const ri=await fileInfo(runtime.gameDir,options.file),after=ri?await fs.readFile(ri.file):null;
    if(after)publicContent(after,source);
    if(after && textContent(after)===null)throw new Error('二进制/过大内容需人工审查，不自动回收');
    if(!after && info.config && ['overrides','client_overrides','server_overrides'].some(k=>(info.config[k]??[]).some(rule=>source===rule || (source.startsWith(rule+'/') && info.source.filter(f=>f.startsWith(rule+'/')).length===1))))throw new Error('删除会使显式 override 规则为空，请人工同时调整规则');
    await assertStopped(runtime.gameDir,options.stopped,options.probe);
    if((await sourceSnapshot(root,target)).fingerprint!==report.sourceFingerprint)throw new Error('写入前源已变化');
    if((await fileInfo(runtime.gameDir,options.file))?.hash!==(ri?.hash))throw new Error('写入前实例已变化');
    return replaceSource(root,target,source,before,after,{operation:'collect',runtime:runtime.id},options);
  }));
}

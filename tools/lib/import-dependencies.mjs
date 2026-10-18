import { progress } from './progress.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {checkImportIntegrity,checkImportConfig,candidateHash} from './import-integrity.mjs';
import {safePath,readJson} from './workspace.mjs';
import {verifyRuntime} from './runtimes.mjs';
import {checkJournal} from './deploy.mjs';
import {inventory,textDiff,sourceBytes} from './changes.mjs';
import {sourceSnapshot,digest} from './prepare.mjs';
import {fileInfo,atomicJson} from './runtime-fs.mjs';
import {pakku,requireSuccess} from './pakku.mjs';
import {checkTarget} from './check.mjs';
import {acceptDependencies,assertNoPendingDependencyWrite} from './dependencies.mjs';

const matches=(file,hashes)=>['sha512','sha256','sha1'].some(algorithm=>file.hashes?.[algorithm]===hashes[algorithm]);

// Only inventory active top-level mods. Pakku, not filenames or embedded metadata, resolves identity.
export async function scanImportDependencies(root,runtime,target) {
  await verifyRuntime(root,runtime,target);await checkJournal(root,runtime);
  await assertNoPendingDependencyWrite(root,target);
  const info=await sourceSnapshot(root,target),known=(info.lock.projects??[]).flatMap(p=>p.files??[]);
  const candidates=[],skipped=[];
  const localPaths=new Set(info.mapping.filter(m=>m.side!=='server').map(m=>m.destination.toLowerCase()));
  for(const name of await inventory(runtime.gameDir,'mods')) {
    if(!/^mods\/[^/]+\.jar$/i.test(name)) {skipped.push({path:name,reason:'仅识别 mods 根目录中启用的 JAR'});continue;}
    if(localPaths.has(name.toLowerCase())) {skipped.push({path:name,reason:'项目 overrides 已管理此路径；如有修改，请在 Changes 中检查'});continue;}
    const file=await safePath(runtime.gameDir,name),stat=await fs.lstat(file);
    if(stat.size>256*1024*1024) {skipped.push({path:name,reason:'文件超过 256 MiB'});continue;}
    const current=await fileInfo(runtime.gameDir,name);
    if(!current)throw new Error('扫描期间 JAR 已变化');
    const bytes=await fs.readFile(current.file),hashes=Object.fromEntries(['sha1','sha256','sha512'].map(a=>[a,digest(bytes,a)]));
    if(hashes.sha256!==current.hash)throw new Error('扫描期间 JAR 已变化');
    if(known.some(f=>matches(f,hashes))) {skipped.push({path:name,reason:'当前 Pakku 锁文件已管理相同内容'});continue;}
    candidates.push({path:name,hash:hashes.sha256,size:bytes.length,hashes});
  }
  return {action:'import-deps',runtime:runtime.id,target:target.id,candidates,skipped,notice:'候选尚未确认项目身份。点选后由 Pakku 按文件哈希联网识别；不复制 JAR 到正式源。'};
}

export async function importDependencies(root,runtime,target,options={}) {
  if(options.candidate) {
    if(options.file||options.sha256||options.selection!==undefined||options.files!==undefined)throw new Error('接受候选不能同时指定 --file / --sha256 / --selection');
    if(!/^[a-f0-9-]{36}$/.test(options.candidate))throw new Error('候选 ID 无效');
    const record=await readJson(await safePath(root,`.work/candidates/${options.candidate}/review.json`));
    if(record.importSource?.key!==runtime.key||record.importSource?.runtime!==runtime.id)throw new Error('候选不属于当前导入实例');
    return acceptDependencies(root,target,options);
  }
  if(options.confirm||options.acceptHash)throw new Error('请先生成并审查导入候选，再通过 --candidate / --accept-hash / --confirm 接受');
  const batch=options.selection!==undefined || options.files!==undefined;
  if(batch&&(options.file||options.sha256))throw new Error('--selection 不能与 --file / --sha256 同时使用');
  if(options.selection!==undefined&&options.files!==undefined)throw new Error('不能重复指定导入列表');
  const requested=options.selection!==undefined?await readJson(path.resolve(root,options.selection)):options.files;
  if(batch&&(!Array.isArray(requested)||!requested.length||requested.some(item=>!item||typeof item.path!=='string'||!/^mods\/[^/]+\.jar$/i.test(item.path)||!/^[a-f0-9]{64}$/.test(item.hash??''))))throw new Error('批量列表需要非空数组，每项包含 mods/<文件>.jar 的 path 与扫描 SHA256 hash');
  progress('import.scan','正在识别 Runtime 中的新增 JAR');
  const report=await scanImportDependencies(root,runtime,target);
  if(!batch&&!options.file) {if(options.sha256)throw new Error('--sha256 需要 --file');return report;}
  const summary={action:'import-batch',recognized:[],skipped:[],failed:[],pending:0,blocked:false,logs:''};
  const selected=[],seen=new Set();
  for(const input of batch?requested:[{path:options.file,hash:options.sha256}]) {
    const item=report.candidates.find(c=>c.path===input.path);
    if(!item||input.hash!==item.hash) {
      if(!batch)throw new Error('请选择列表中的新增 JAR，并用 --sha256 确认其扫描哈希');
      const skipped=report.skipped.find(c=>c.path===input.path);
      if(skipped?.reason==='当前 Pakku 锁文件已管理相同内容'&&(await fileInfo(runtime.gameDir,input.path))?.hash===input.hash)summary.skipped.push({...input,reason:skipped.reason});
      else summary.failed.push({path:input.path,reason:'不在新增候选中或扫描哈希已变化，请重新扫描'});
      continue;
    }
    if(seen.has(item.hash)) {summary.skipped.push({path:item.path,reason:'与本批其他 JAR 内容相同，跳过重复文件'});continue;}
    selected.push(item);seen.add(item.hash);
  }
  if(batch&&(summary.failed.length||!selected.length)) {summary.blocked=summary.failed.length>0;return summary;}
  const info=await sourceSnapshot(root,target),id=randomUUID(),projectPath=`.work/candidates/${id}/project`,dir=await safePath(root,projectPath);
  // One isolated native Pakku project and one sync invocation for the entire selection.
  if(info.config.paths?.mods && info.config.paths.mods!=='mods')throw new Error('依赖导入暂只支持默认 mods 路径');
  await fs.mkdir(dir,{recursive:true});
  for(const name of info.source) {const dest=await safePath(dir,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(info.dir,name),dest);}
  const originalConfig=await fs.readFile(path.join(dir,'pakku.json')),staged=[];
  let candidate,added;
  try {
    try {
      for(const [i,item] of selected.entries()) {
        const dest=await safePath(dir,batch?`mods/import-${i}.jar`:'mods/import.jar');
        await fs.mkdir(path.dirname(dest),{recursive:true});
        const bytes=await fs.readFile(await safePath(runtime.gameDir,item.path));
        if(digest(bytes)!==item.hash)throw new Error(`准备期间 JAR 已变化: ${item.path}`);
        await fs.writeFile(dest,bytes,{flag:'wx'});staged.push(dest);
      }
      const result=await pakku(root,dir,['--yes','sync','--additions'],{...options,capture:true});
      summary.logs=[result.stdout,result.stderr].filter(Boolean).join('\n');requireSuccess(result);
    } finally {
      for(const dest of staged)await fs.unlink(dest);
      await fs.rmdir(path.join(dir,'mods')).catch(e=>{if(!['ENOTEMPTY','ENOENT'].includes(e.code))throw e;});
    }
    // sync serializes pakku.json; restore formatting only when its data is identical.
    const nextConfig=await readJson(await safePath(dir,'pakku.json'));
    summary.configChanges=checkImportConfig(info.config,nextConfig);
    if(isDeepStrictEqual(info.config,nextConfig))await fs.writeFile(await safePath(dir,'pakku.json'),originalConfig);
    progress('import.verify','正在校验候选 Lock 与已有依赖');
    await checkTarget(root,{...target,path:projectPath},options);
    candidate=await sourceSnapshot(root,{...target,path:projectPath});
    summary.diff=textDiff(await sourceBytes(info.dir,'pakku-lock.json'),await sourceBytes(dir,'pakku-lock.json'));
    for(const name of new Set([...info.source,...candidate.source]))if(!['pakku-lock.json','pakku.json'].includes(name)&&info.hashes[name]!==candidate.hashes[name])throw new Error('Pakku 修改了锁文件之外的源，拒绝导入');
    added=checkImportIntegrity(info.lock,candidate.lock);
    for(const p of added)for(const file of p.files??[]) {
      if(file.mc_versions?.length&&!file.mc_versions.some(v=>candidate.lock.mc_versions.includes(v)))throw new Error(`新增依赖 Minecraft 版本不兼容: ${Object.values(p.slug??{}).join(' / ')}`);
      if(file.loaders?.length&&!file.loaders.some(l=>Object.hasOwn(candidate.lock.loaders,l)))throw new Error(`新增依赖 Loader 不兼容: ${Object.values(p.slug??{}).join(' / ')}`);
    }
  } catch(error) {
    if(!batch)throw error;
    summary.blocked=true;summary.failed.push(...selected.map(item=>({path:item.path,reason:'整批候选校验失败: '+error.message})));return summary;
  }
  const identifiedIds=new Set();
  for(const item of selected) {
    const identified=added.filter(p=>p.type==='MOD'&&(p.files??[]).some(f=>matches(f,item.hashes)));
    let reason;
    if(identified.length!==1)reason='Pakku 未唯一识别该新增 Mod；可能来源未知、版本不兼容或与已有依赖版本偏离。未导入';
    else if((await fileInfo(runtime.gameDir,item.path))?.hash!==item.hash)reason='识别期间 JAR 已变化';
    if(reason) {if(!batch)throw new Error(reason);summary.failed.push({path:item.path,reason});continue;}
    const p=identified[0];
    if(identifiedIds.has(p.pakku_id))summary.failed.push({path:item.path,reason:'多个不同内容的 JAR 对应同一 Project，可能版本冲突，请只选择一个版本'});
    else summary.recognized.push({path:item.path,project:Object.values(p.slug??{}).join(' / '),pakkuId:p.pakku_id});
    identifiedIds.add(p.pakku_id);
  }
  if(summary.failed.length) {summary.blocked=true;return summary;}
  if((await sourceSnapshot(root,target)).fingerprint!==info.fingerprint)throw new Error('识别期间正式源已变化，请重新生成候选');
  const before=await sourceBytes(info.dir,'pakku-lock.json'),after=await sourceBytes(dir,'pakku-lock.json');
  const configAfter=await sourceBytes(dir,'pakku.json'),configChanged=digest(configAfter)!==digest(originalConfig);
  const configDiff=configChanged?textDiff(originalConfig,configAfter):undefined;
  const inputs=selected.map(item=>({file:item.path,hash:item.hash}));
  const record={schema:1,id,targetId:target.id,sourceFingerprint:info.fingerprint,operation:'import',project:summary.recognized.map(p=>p.project).join(' / '),hash:candidateHash(after,configChanged?configAfter:undefined),...(configChanged?{configHash:digest(configAfter)}:{}),before:digest(before),importSource:{runtime:runtime.id,key:runtime.key,...(batch?{files:inputs}:inputs[0])}};
  await atomicJson(await safePath(root,`.work/candidates/${id}/review.json`),record);
  return {...(batch?{...summary,pending:added.length}:{}),...record,logs:summary.logs,projectPath,added:added.map(p=>({name:p.name,id:p.id,slug:p.slug,files:p.files?.map(f=>({name:f.file_name,id:f.id}))})),diff:textDiff(before,after),configDiff,configChanges:summary.configChanges,notice:'请审查全部新增依赖及许可后接受；一次确认写入 Pakku 配置和锁文件并备份，不修改实例 JAR。'};
}

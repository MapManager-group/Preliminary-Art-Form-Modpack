import fs from 'node:fs/promises';
import path from 'node:path';
import { safePath } from './workspace.mjs';
import { sourceSnapshot, readPrepared, digest } from './prepare.mjs';
import { fileInfo, localPath, optionalJson, managedPath, runtimePath } from './runtime-fs.mjs';
import { validateBaseline, checkJournal } from './deploy.mjs';
import { verifyRuntime } from './runtimes.mjs';

export function compareThree(b,s,r) {
  if(s===r)return s===b?'unchanged':'consistent';
  if(r===b)return 'source-only';
  if(s===b)return 'runtime-only';
  return 'conflict';
}
export async function sourceBytes(dir,name) {
  const file=await safePath(dir,name);
  try {
    const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.nlink!==1)throw new Error('源必须是独立普通文件');
    return await fs.readFile(file);
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function textContent(bytes) {
  if(bytes===null)return '';
  if(bytes.length>256*1024 || bytes.includes(0))return null;
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}
}
// Deliberately complete, bounded before/after text: no heuristic diff can hide removed lines.
export function textDiff(before,after) {
  const a=textContent(before),b=textContent(after);
  if(a===null||b===null)return {binary:true,description:'二进制或超过 256 KiB，仅显示哈希；需人工审查'};
  return {binary:false,text:['--- source','+++ runtime',...a.split('\n').map(l=>'-'+l),...b.split('\n').map(l=>'+'+l)].join('\n')};
}
export async function inventory(gameDir,prefix) {
  const result=[];
  async function visit(name) {
    const dir=await safePath(gameDir,name);
    let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
    for(const entry of entries) {
      const child=`${name}/${entry.name}`;
      try{managedPath(child);}catch{continue;}
      if(entry.isSymbolicLink())throw new Error(`拒绝链接: ${child}`);
      if(entry.isDirectory())await visit(child);
      else if(entry.isFile())result.push(child);
      else throw new Error(`非普通文件: ${child}`);
    }
  }
  await visit(prefix);return result.sort();
}
export async function changes(root,runtime,target,{diff=false}={}) {
  await verifyRuntime(root,runtime,target);await checkJournal(root,runtime);
  const info=await sourceSnapshot(root,target);
  const baseline=await optionalJson(await localPath(root,`runtimes/${runtime.key}/baseline.json`));
  validateBaseline(baseline,runtime);
  const old=new Map((baseline?.files??[]).map(f=>[f.path,f]));
  const mapping=new Map();
  for(const side of ['common','client'])for(const m of info.mapping.filter(m=>m.side===side))mapping.set(m.destination,m);
  const managed=[],conflicts=[],candidates=[],dependencies=[];
  const names=new Set([...mapping.keys(),...[...old.values()].filter(f=>f.kind==='override').map(f=>f.path)]);
  for(const name of [...names].sort()) {
    runtimePath(runtime,name);
    const b=old.get(name),m=mapping.get(name);
    if(b && b.kind!=='override')continue;
    const r=await fileInfo(runtime.gameDir,name);
    const s=m?info.hashes[m.source]:null;
    const state=b && m && (b.source!==m.source || b.side!==m.side)?'conflict':compareThree(b?.hash??null,s,r?.hash??null);
    const item={path:name,source:m?.source??b?.source,side:m?.side??b?.side,state,baseline:b?.hash??null,currentSource:s,runtime:r?.hash??null};
    if(diff && state!=='unchanged') {
      const sb=m?await sourceBytes(info.dir,m.source):null;
      const rb=r?await fs.readFile(r.file):null;
      item.diff=textDiff(sb,rb);
      if(b) {
        let bb=await sourceBytes(root,`.local/runtimes/${runtime.key}/blobs/${b.hash}`);
        if(bb && digest(bb)!==b.hash)throw new Error('配置基线内容损坏');
        // Phase 2 migration: a matching side is sufficient; otherwise report absent B content.
        if(!bb && s===b.hash)bb=sb;
        if(!bb && r?.hash===b.hash)bb=rb;
        item.baselineText=bb?textContent(bb):null;
      }
    }
    (state==='conflict'?conflicts:managed).push(item);
  }
  let expected=[...old.values()].filter(f=>f.kind!=='override'),dependencySource='last-deployment';
  if(!baseline || info.hashes['pakku-lock.json']!==baseline.source.lockHash || (baseline.source.configHash?info.hashes['pakku.json']!==baseline.source.configHash:info.fingerprint!==baseline.source.fingerprint)) {
    try{expected=(await readPrepared(root,target,info)).files.filter(f=>f.kind!=='override');dependencySource='current-prepared';}
    catch(e){if(e.code!=='ENOENT')throw e;dependencySource='prepare-required';}
  }
  const depMap=new Map(expected.map(f=>[f.path,f]));
  for(const file of expected) {
    const current=await fileInfo(runtime.gameDir,file.path);
    const hash=current?digest(await fs.readFile(current.file),file.algorithm):null;
    if(hash!==file.hash)dependencies.push({path:file.path,state:current?'replaced':'missing',expected:file.hash,actual:hash});
  }
  for(const name of await inventory(runtime.gameDir,'mods')) {
    if(depMap.has(name)||names.has(name))continue;
    const enabled=name.replace(/\.(disabled|disable|bak)$/i,'');
    if(!/\.jar(?:\.(disabled|disable|bak))?$/i.test(name))continue;
    const current=await fileInfo(runtime.gameDir,name);
    const expectedFile=depMap.get(enabled);
    const known=expectedFile && digest(await fs.readFile(current.file),expectedFile.algorithm)===expectedFile.hash;
    dependencies.push({path:name,state:known?'disabled':'extra',resolution:known?'locked':'unresolved',hash:current.hash});
  }
  for(const name of await inventory(runtime.gameDir,'config')) {
    if(names.has(name)||depMap.has(name))continue;
    try{managedPath(name);}catch{continue;}
    const r=await fileInfo(runtime.gameDir,name),bytes=await fs.readFile(r.file);
    const item={path:name,state:'candidate',hash:r.hash,binary:textContent(bytes)===null};
    if(diff)item.diff=textDiff(null,bytes);
    candidates.push(item);
  }
  return {runtime:runtime.id,targetId:target.id,sourceFingerprint:info.fingerprint,baseline:baseline?.source??null,managed,conflicts,candidates,dependencies,dependencySource,privateData:'未声明的 options 不自动发现；存档、账户、截图、日志不遍历、不回收'};
}
export function formatChanges(report) {
  const rows=[`Runtime ${report.runtime} / Target ${report.targetId}`,`依赖依据: ${report.dependencySource}`,report.privateData];
  for(const [label,items] of [['受管文件',report.managed],['冲突',report.conflicts],['新候选（需明确源映射）',report.candidates],['依赖偏离',report.dependencies]]) {
    rows.push(`${label}: ${items.length}`);
    for(const item of items){rows.push(`  ${item.state} ${item.path}${item.source?' → '+item.source:''}${item.resolution?' ['+item.resolution+']':''}`);if(item.diff)rows.push(item.diff.text??item.diff.description);}
  }
  return rows.join('\n');
}

import { progress } from './progress.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safePath } from './workspace.mjs';
import { inspectTarget, checkTarget } from './check.mjs';
import { inspectArchive } from './archive.mjs';
import { exportPakku, sha256, run, verifiedTool } from './pakku.mjs';
import { atomicJson, managedPath, optionalJson } from './runtime-fs.mjs';

export const digest = (bytes, algorithm='sha256') => createHash(algorithm).update(bytes).digest('hex');
export function validateDownload(entry) {
  managedPath(entry.path);
  if (!['required','optional','unsupported'].includes(entry.env?.client ?? 'required')) throw new Error(`未知客户端侧别: ${entry.path}`);
  if (!/^[a-f0-9]{128}$/.test(entry.hashes?.sha512 ?? '') || !/^[a-f0-9]{40}$/.test(entry.hashes?.sha1 ?? '')) throw new Error(`缺少可信哈希: ${entry.path}`);
  if (!Number.isSafeInteger(entry.fileSize) || entry.fileSize < 0 || entry.fileSize > 512*1024*1024 || !Array.isArray(entry.downloads) || !entry.downloads.length) throw new Error(`无效/超过 512 MiB 下载记录: ${entry.path}`);
  for (const url of entry.downloads) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('依赖下载仅支持无凭据 HTTPS URL');
  }
}
export async function sourceSnapshot(root,target) {
  const info = await inspectTarget(root,target);
  const hashes = {};
  for (const file of info.source) hashes[file] = sha256(await fs.readFile(path.join(info.dir,file)));
  const tool = await verifiedTool(root);
  return {...info,hashes,fingerprint:sha256(Buffer.from(JSON.stringify({hashes,pakku:tool.sha256}))),pakku:tool.version};
}
export function clientManifest(entries, info) {
  const index = JSON.parse(new TextDecoder().decode(entries['modrinth.index.json']));
  const selected = new Map();
  const put = (item, replace=false) => {
    managedPath(item.path);
    const key = item.path.toLowerCase();
    if (selected.has(key) && !replace) throw new Error(`重复部署路径: ${item.path}`);
    selected.set(key,item);
  };
  for (const dep of index.files) {
    validateDownload(dep);
    if (dep.env?.client === 'unsupported') continue;
    put({path:dep.path,kind:'dependency',source:'pakku-lock.json',algorithm:'sha512',hash:dep.hashes.sha512,hashes:dep.hashes,downloads:dep.downloads,size:dep.fileSize});
  }
  // Modrinth client semantics: indexed downloads < common overrides < client overrides.
  for (const prefix of ['overrides/','client-overrides/']) {
    for (const [name,bytes] of Object.entries(entries)) {
      if (!name.startsWith(prefix) || name.endsWith('/')) continue;
      const mapping = info.mapping.find(m=>m.archivePath===name);
      if (mapping && sha256(bytes) !== info.hashes[mapping.source]) throw new Error(`导出内容与源映射不一致: ${name}`);
      put({path:name.slice(prefix.length),kind:mapping?'override':'exported-dependency',source:mapping?.source ?? `pakku-export:${name}`,side:prefix==='overrides/'?'common':'client',algorithm:'sha256',hash:sha256(bytes),size:bytes.length,archivePath:name},true);
    }
  }
  const files = [...selected.values()].sort((a,b)=>a.path.localeCompare(b.path));
  for (const a of files) for (const b of files) if (a!==b && b.path.toLowerCase().startsWith(a.path.toLowerCase()+'/')) throw new Error('部署文件/目录路径冲突');
  return {dependencies:index.dependencies,files};
}
export async function prepare(root,target,options={}) {
  progress('prepare.check','正在检查目标并准备同步清单');
  const info = await sourceSnapshot(root,target);
  if (!['modrinth','multiplatform'].includes(info.lock.target)) throw new Error('实例同步需要可导出 MRPACK 的 Pakku 目标（modrinth 或 multiplatform）');
  const existing = await readPrepared(root,target,info).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if (existing) return existing;
  await checkTarget(root,target,options);
  const base = await safePath(root,'.work'); await fs.mkdir(base,{recursive:true});
  const work = await fs.mkdtemp(path.join(base,`prepare-${target.id}-`));
  for(const file of info.source) { const dest=path.join(work,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(info.dir,file),dest); }
  await exportPakku(root,work,options);
  const dir=path.join(work,'build','modrinth');
  const names=(await fs.readdir(dir)).filter(n=>n.endsWith('.mrpack'));
  if(names.length!==1)throw new Error('Pakku 未生成唯一 MRPACK');
  progress('prepare.verify','正在校验客户端清单');
  const bytes=await fs.readFile(path.join(dir,names[0]));
  const entries=inspectArchive(bytes,'modrinth');
  const content=clientManifest(entries,info);
  if ((await sourceSnapshot(root,target)).fingerprint!==info.fingerprint)throw new Error('准备期间源文件变化，请重试');
  const git=await run('git',['rev-parse','HEAD'],{cwd:root,capture:true});
  const dirty=await run('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,capture:true});
  const manifest={schema:1,targetId:target.id,fingerprint:info.fingerprint,pakku:info.pakku,version:info.config.version,lockHash:info.hashes['pakku-lock.json'],configHash:info.hashes['pakku.json'],git:git.code===0?git.stdout.trim():null,dirty:dirty.code!==0||Boolean(dirty.stdout.trim()),...content};
  const destination=await safePath(root,`.work/prepared/${target.id}/${info.fingerprint}`);
  await fs.mkdir(destination,{recursive:true});
  for(const file of manifest.files.filter(f=>f.kind!=='dependency'))await fs.writeFile(await safePath(destination,file.hash),entries[file.archivePath]);
  await atomicJson(await safePath(destination,'manifest.json'),manifest);
  return {...manifest,directory:destination};
}
export async function readPrepared(root,target,info) {
  info ??= await sourceSnapshot(root,target);
  const directory=await safePath(root,`.work/prepared/${target.id}/${info.fingerprint}`);
  const manifest=await optionalJson(await safePath(directory,'manifest.json'));
  if (!manifest)throw Object.assign(new Error('没有与当前源快照匹配的准备清单；先运行 mp prepare --target '+target.id),{code:'ENOENT'});
  if(manifest.schema!==1||manifest.targetId!==target.id||manifest.fingerprint!==info.fingerprint||!Array.isArray(manifest.files))throw new Error('准备清单无效');
  const names=new Set();
  for(const file of manifest.files) {
    managedPath(file.path);
    if(names.has(file.path.toLowerCase()))throw new Error('准备清单存在重复路径');
    names.add(file.path.toLowerCase());
    if(!['sha256','sha512'].includes(file.algorithm)||!new RegExp(`^[a-f0-9]{${file.algorithm==='sha512'?128:64}}$`).test(file.hash))throw new Error('准备清单哈希无效');
    if(file.kind==='dependency')validateDownload({path:file.path,hashes:file.hashes,downloads:file.downloads,fileSize:file.size});
  }
  return {...manifest,directory};
}
export async function cachedBytes(root,prepared,file) {
  if(prepared.content?.[file.hash]) {
    const bytes=prepared.content[file.hash];
    if(digest(bytes,file.algorithm)!==file.hash||bytes.length!==file.size)throw new Error('导入内容哈希/长度不符');
    return bytes;
  }
  const location = file.kind==='dependency' ? await safePath(root,`.cache/dependencies/${file.hash}`) : await safePath(prepared.directory,file.hash);
  try {
    const bytes=await fs.readFile(location);
    if(digest(bytes,file.algorithm)!==file.hash || bytes.length!==file.size)throw new Error(`缓存损坏: ${file.path}`);
    if(file.hashes && digest(bytes,'sha1')!==file.hashes.sha1)throw new Error(`SHA-1 不匹配: ${file.path}`);
    return bytes;
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export async function obtainBytes(root,prepared,file,download=fetch) {
  const cached=await cachedBytes(root,prepared,file);if(cached)return cached;
  if(file.kind!=='dependency')throw new Error(`准备内容丢失: ${file.path}`);
  let last;
  for(const url of file.downloads) {
    try {
      const response=await download(url,{signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      if(response.url && new URL(response.url).protocol!=='https:')throw new Error('下载跳转必须使用 HTTPS');
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>file.size)throw new Error('下载长度超过声明大小');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);
      if(bytes.length!==file.size || digest(bytes,'sha512')!==file.hash || digest(bytes,'sha1')!==file.hashes.sha1)throw new Error('依赖下载哈希/长度不匹配');
      const dest=await safePath(root,`.cache/dependencies/${file.hash}`);await fs.mkdir(path.dirname(dest),{recursive:true});
      // Content-addressed files are written after full validation; a failed download cannot become valid cache.
      await fs.writeFile(dest,bytes);return bytes;
    }catch(e){last=e;}
  }
  throw new Error(`下载失败 ${file.path}: ${last?.message}`);
}

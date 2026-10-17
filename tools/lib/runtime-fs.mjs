import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { safePath } from './workspace.mjs';
import { sha256 } from './pakku.mjs';
import { managedPath } from './content-policy.mjs';
export { managedPath } from './content-policy.mjs';

export const pathKey = p => process.platform === 'win32' ? p.toLowerCase() : p;
export const within = (parent, child) => pathKey(child) === pathKey(parent) || pathKey(child).startsWith(pathKey(parent + path.sep));
export async function optionalJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
// Reject links in every component, not just the leaf. Never follow junctions during mutation.
export async function absoluteDirectory(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.split(/[\\/]/).includes('..')) throw new Error('需要不含 .. 的绝对目录');
  const resolved = path.resolve(input);
  const anchor = path.parse(resolved).root;
  if (resolved === anchor) throw new Error('不能使用磁盘根目录');
  let current = anchor;
  for (const part of resolved.slice(anchor.length).split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`目录含 junction/symlink 或非目录: ${current}`);
  }
  return fs.realpath(resolved);
}
export function runtimePath(runtime,name) {
  managedPath(name);
  const destination=path.resolve(runtime.gameDir,...name.split('/'));
  const versionId=path.basename(runtime.versionDir);
  for(const extension of ['json','jar']) {
    const reserved=path.resolve(runtime.versionDir,versionId+'.'+extension);
    if(destination.toLowerCase()===reserved.toLowerCase())throw new Error('禁止纳管实际启动器版本文件: '+name);
  }
  return name;
}
export async function fileInfo(root, name) {
  await absoluteDirectory(root);
  managedPath(name);
  const file = await safePath(root, name);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.nlink > 1) throw new Error(`非普通独立文件: ${name}`);
    return { hash: sha256(await fs.readFile(file)), mode: stat.mode, file };
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, JSON.stringify(value,null,2)+'\n', {flag:'wx'}); await fs.rename(temp,file); }
  finally { await fs.rm(temp,{force:true}); }
}
export async function localPath(root, relative) { return safePath(root, `.local/${relative}`); }
export const runtimeKey = dir => sha256(Buffer.from(pathKey(dir)));

// Cross-workspace lock, shared by all aliases and launcher names of the same real directory.
// A crashed process leaves evidence. Stale locks are NOT silently stolen.
export async function lockOperation(key, fn) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('无效锁标识');
  const base = path.join(os.tmpdir(),'db-modpack-workflow-locks');
  await fs.mkdir(base,{recursive:true});
  await absoluteDirectory(base);
  const file = await safePath(base,`${key}.lock`);
  let handle;
  try { handle = await fs.open(file,'wx'); }
  catch(e) { if(e.code==='EEXIST') throw new Error(`操作已锁定；若进程已退出，请人工核实并移走锁文件后 recover: ${file}`); throw e; }
  try { await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()})); return await fn(); }
  finally { await handle.close(); await fs.unlink(file); }
}

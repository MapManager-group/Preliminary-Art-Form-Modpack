import fs from 'node:fs/promises';
import path from 'node:path';

export const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export const isTargetId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]*$/.test(value) && value.trim() === value;
export function relativePath(value) {
  if (typeof value !== 'string' || !value || /[\\:\x00-\x1f]/u.test(value) || value.startsWith('/') || value.split('/').some(x => !x || x === '.' || x === '..' || /[. ]$/.test(x))) {
    throw new Error(`不安全的相对路径: ${value}`);
  }
  return value;
}
export async function safePath(root, relative) {
  relativePath(relative);
  // The root can itself be replaced by a junction between operations. Check its ancestors too.
  root = path.resolve(root);
  const anchor = path.parse(root).root;
  let ancestor = anchor;
  for (const part of root.slice(anchor.length).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor,part);
    try { if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error(`禁止符号链接/junction: ${ancestor}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`禁止符号链接/junction: ${current}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return current;
}
export async function loadWorkspace(root) {
  const w = await readJson(path.join(root, 'workspace.json'));
  if (!w || Object.keys(w).some(k => !['targets', 'defaultTarget'].includes(k)) || !Array.isArray(w.targets) || !w.targets.length) throw new Error('workspace Schema: targets 必须是非空数组');
  const ids = new Set(), paths = [];
  for (const t of w.targets) {
    if (!t || Object.keys(t).some(k => !['id','path','artifacts'].includes(k)) || !isTargetId(t.id) || ids.has(t.id)) throw new Error('Target ID 无效或重复');
    ids.add(t.id);
    const absolute = await safePath(root, t.path);
    if (!(await fs.stat(absolute)).isDirectory()) throw new Error(`Target 不存在: ${t.path}`);
    const key = t.path.toLowerCase();
    if (!key.startsWith('packs/') || paths.some(p => key === p || key.startsWith(p + '/') || p.startsWith(key + '/'))) throw new Error('Target 路径重复、嵌套或不属于 packs/');
    paths.push(key);
    if (!Array.isArray(t.artifacts) || !t.artifacts.length || new Set(t.artifacts).size !== t.artifacts.length || t.artifacts.some(a => !['modrinth','curseforge','serverpack'].includes(a))) throw new Error('无效/重复 Artifact 类型');
  }
  if (w.defaultTarget !== undefined && !ids.has(w.defaultTarget)) throw new Error('默认 Target 不存在');
  return w;
}
export async function selectTarget(root, w, explicit) {
  let id = explicit;
  if (!id) {
    try { id = (await readJson(await safePath(root, '.local/selection.json'))).target; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    id ??= w.defaultTarget ?? (w.targets.length === 1 ? w.targets[0].id : undefined);
  }
  const t = w.targets.find(t => t.id === id);
  if (!t) throw new Error(`请选择有效 Target: --target <id> 或 mp use <id> (${id ?? '未选择'})`);
  return t;
}
export async function filesUnder(root, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`禁止符号链接/junction: ${rel}`);
    if (entry.isDirectory()) result.push(...await filesUnder(root, rel));
    else if (entry.isFile()) result.push(rel);
    else throw new Error(`非普通文件: ${rel}`);
  }
  return result.sort();
}

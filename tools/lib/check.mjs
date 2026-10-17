import fs from 'node:fs/promises';
import path from 'node:path';
import { filesUnder, readJson, relativePath, safePath } from './workspace.mjs';
import { pakku, requireSuccess } from './pakku.mjs';
import { managedPath, publicContent } from './content-policy.mjs';

const runtime = /^(?:build\/|\.pakku\/(shelf|remote|docs|exports)(\/|$))/;
export async function inspectTarget(root, target) {
  const dir = await safePath(root, target.path);
  const files = await filesUnder(dir);
  const source = files.filter(f => !runtime.test(f));
  for (const file of source) {
    relativePath(file);
    const contentPath=file.replace(/^\.pakku\/(?:(?:overrides|client-overrides|server-overrides)\/)?/,'');
    managedPath(contentPath);
    const text = await fs.readFile(path.join(dir, file));
    publicContent(text,file);
  }
  const config = await readJson(path.join(dir, 'pakku.json'));
  const lock = await readJson(path.join(dir, 'pakku-lock.json'));
  if (!config || typeof config.name !== 'string' || !config.name.trim() || typeof config.version !== 'string' || !config.version.trim()) throw new Error('Pakku name/version 必须非空');
  if (/[\\/:*?"<>|\x00-\x1f]/.test(config.name + config.version)) throw new Error('包名/版本含不安全输出文件名字符');
  if (![1,2].includes(lock.lockfile_version) || !['modrinth','curseforge','multiplatform'].includes(lock.target) || !Array.isArray(lock.mc_versions) || !lock.mc_versions.length || lock.mc_versions.some(v => typeof v !== 'string') || !lock.loaders || typeof lock.loaders !== 'object' || Array.isArray(lock.loaders) || Object.values(lock.loaders).some(v => typeof v !== 'string' || !v)) throw new Error('Pakku 锁数据无效');
  if (lock.projects !== undefined && !Array.isArray(lock.projects)) throw new Error('Pakku projects 必须是数组');
  for (const value of Object.values(config.paths ?? {})) relativePath(value);
  // Exact mappings keep source hashing and export validation consistent.
  const output = new Map(), mapping = [];
  const claim = (side, destination, origin) => {
    managedPath(destination);
    for (const scope of side === 'common' ? ['client','server'] : [side]) {
      const key = `${scope}/${destination}`.toLowerCase();
      const previous = output.get(key);
      if (previous && !(previous.side === 'common' && side !== 'common' && previous.origin !== origin)) throw new Error(`重复/冲突输出: ${key} (${previous.origin}, ${origin})`);
      output.set(key, {origin,side});
    }
    mapping.push({source:origin,destination,side,archivePath:`${side === 'common' ? 'overrides' : side+'-overrides'}/${destination}`});
  };
  for (const [field, side] of [['overrides','common'],['client_overrides','client'],['server_overrides','server']]) {
    const rules = config[field] ?? [];
    if (!Array.isArray(rules)) throw new Error(`${field} 必须是数组`);
    for (const rule of rules) {
      relativePath(rule);
      if (/[!*?{}\[\]]/.test(rule)) throw new Error(`检查仅支持明确的文件/目录规则，请展开通配符: ${rule}`);
      if (rule.startsWith('.pakku/')) throw new Error('manual overrides 自动纳入，不要重复声明 .pakku');
      const matched = source.filter(f => f === rule || f.startsWith(rule + '/'));
      if (!matched.length) throw new Error(`override 未匹配文件: ${rule}`);
      for (const f of matched) claim(side, f, f);
    }
  }
  for (const [folder, side] of [['overrides','common'],['client-overrides','client'],['server-overrides','server']]) {
    const prefix = `.pakku/${folder}/`;
    for (const f of source.filter(f => f.startsWith(prefix))) claim(side, f.slice(prefix.length), f);
  }
  const declared=new Set(mapping.map(item=>item.source));
  for(const file of source)if(!declared.has(file)&&(/\.(jar|zip|mrpack)$/i.test(file)||/(^|\/)assets(\/|$)/i.test(file)))throw new Error('归档/资源必须放入正式 overrides 或由 Pakku overrides 规则明确声明: '+file);
  return { dir, source, config, lock, outputs: [...output.keys()], mapping };
}
export async function checkTarget(root, target, options = {}) {
  const inspection = await inspectTarget(root, target);
  const result = requireSuccess(await pakku(root, inspection.dir, ['ls'], { ...options, capture: true }));
  // Pakku 1.5.0 can return 0 on deserialization errors. Success must include the ls summary.
  if (!/Projects total: \d+/.test(result.stdout)) throw new Error(`Pakku 无法读取工程: ${result.stdout}\n${result.stderr}`);
  return inspection;
}

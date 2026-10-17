import fs from 'node:fs/promises';
import path from 'node:path';
import { safePath, readJson } from './workspace.mjs';
import { absoluteDirectory, optionalJson, pathKey, within } from './runtime-fs.mjs';

async function exists(file) { try { await fs.lstat(file); return true; } catch(e) { if(e.code==='ENOENT')return false; throw e; } }
export async function inspectLauncher({launcher, gameDir, versionDir = gameDir}) {
  if (!['pcl2','hmcl'].includes(launcher)) throw new Error('launcher 必须为 pcl2 或 hmcl');
  gameDir = await absoluteDirectory(gameDir);
  versionDir = await absoluteDirectory(versionDir);
  const id = path.basename(versionDir);
  const manifestFile = await safePath(versionDir,`${id}.json`);
  const manifest = await readJson(manifestFile);
  if (manifest.id !== id) throw new Error('版本 JSON 的 id 与版本目录不符');
  const root = path.basename(path.dirname(versionDir)).toLowerCase()==='versions' ? path.dirname(path.dirname(versionDir)) : null;
  let predicted = null, evidence = '未可靠识别隔离设置，需要用户核对实际 gameDir', layout = 'explicit';
  if (launcher === 'pcl2') {
    const file = await safePath(versionDir,'PCL/Setup.ini');
    if (await exists(file)) {
      const ini = await fs.readFile(file,'utf8');
      const v2 = ini.match(/^VersionArgumentIndieV2\s*:\s*(True|False)\s*$/im) ?? ini.match(/^VersionArgumentIndieV2\s*=\s*(True|False)\s*$/im);
      const old = ini.match(/^VersionArgumentIndie\s*[:=]\s*([12])\s*$/im);
      if (v2 || old) {
        const isolated = v2 ? v2[1].toLowerCase()==='true' : old[1]==='1';
        predicted = isolated ? versionDir : root;
        layout = isolated ? 'isolated' : 'shared';
        evidence = v2 ? 'PCL VersionArgumentIndieV2' : 'PCL VersionArgumentIndie 明确值';
      }
    }
  } else {
    const cfg = await optionalJson(await safePath(versionDir,'hmclversion.cfg'));
    if (await exists(await safePath(versionDir,'modpack.cfg'))) {
      predicted = versionDir; layout = 'isolated'; evidence = 'HMCL modpack.cfg';
    } else if (cfg?.usesGlobal === false && [0,1,2].includes(cfg.gameDirType)) {
      layout = ['shared','isolated','custom'][cfg.gameDirType];
      predicted = cfg.gameDirType === 0 ? root : cfg.gameDirType === 1 ? versionDir : path.isAbsolute(cfg.gameDir ?? '') ? cfg.gameDir : null;
      evidence = 'HMCL v3.6.19 本地 hmclversion.cfg（非全局）';
    }
  }
  if (predicted && pathKey(await absoluteDirectory(predicted)) !== pathKey(gameDir)) throw new Error(`gameDir 与已识别设置不符，预期 ${predicted}`);
  if (layout === 'shared' || (root && pathKey(root)===pathKey(gameDir)) || await exists(path.join(gameDir,'versions'))) throw new Error('拒绝公共 Minecraft 根目录；先在启动器启用隔离');
  let mc = typeof manifest.clientVersion === 'string' ? manifest.clientVersion : manifest.inheritsFrom ?? (manifest.id.match(/^\d+\.\d+(?:\.\d+)?$/) ? manifest.id : null);
  const loaders = {};
  for (const lib of manifest.libraries ?? []) {
    const match = lib.name?.match(/^(net\.fabricmc:fabric-loader|org\.quiltmc:quilt-loader|net\.neoforged:neoforge|net\.minecraftforge:forge):([^:]+)/);
    if (match) loaders[{'net.fabricmc:fabric-loader':'fabric','org.quiltmc:quilt-loader':'quilt','net.neoforged:neoforge':'neoforge','net.minecraftforge:forge':'forge'}[match[1]]] = match[2];
  }
  // HMCL merged manifests often retain patch metadata; only consume explicit fields.
  for (const patch of manifest.patches ?? []) {
    if (patch.id === 'game' && typeof patch.version === 'string') mc = patch.version;
    if (['fabric','quilt','neoforge','forge'].includes(patch.id) && typeof patch.version === 'string') loaders[patch.id] = patch.version;
  }
  return {launcher,gameDir,versionDir,versionId:id,layout,evidence,mc,loaders};
}
export function matchVersion(probe, lock) {
  if (!probe.mc || !lock.mc_versions.includes(probe.mc)) throw new Error(`Minecraft 版本不匹配或无法确认: ${probe.mc ?? 'unknown'}`);
  for (const [name, version] of Object.entries(lock.loaders)) {
    if (probe.loaders[name] !== version) throw new Error(`加载器 ${name} 版本不匹配或无法确认，需要 ${version}`);
  }
  if (Object.keys(probe.loaders).some(k => !(k in lock.loaders))) throw new Error('实例存在额外加载器');
}
export async function validateGameDir(workspaceRoot, gameDir) {
  const canonical = await absoluteDirectory(gameDir);
  const repo = await absoluteDirectory(workspaceRoot);
  if (within(repo,canonical) || within(canonical,repo)) throw new Error('Runtime 不得位于工作区源目录或其父目录');
  let ancestor = canonical;
  while (ancestor !== path.parse(ancestor).root) {
    if (await exists(path.join(ancestor,'.git'))) throw new Error('Runtime 不得处于 Git 源仓库');
    ancestor = path.dirname(ancestor);
  }
  await fs.access(canonical, fs.constants.R_OK | fs.constants.W_OK);
  return canonical;
}

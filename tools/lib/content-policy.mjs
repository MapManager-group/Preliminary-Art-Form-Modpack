import {relativePath} from './workspace.mjs';

// Structural safety applies to every archive entry, independently of its purpose.
export function portablePath(name) {
  relativePath(name);
  if(name.split('/').some(p=>/[<>"|?*]/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw new Error(`不安全 Windows 路径: ${name}`);
  return name;
}
// Paths are relative to the game directory, not to an archive wrapper or source root.
export function managedPath(name) {
  portablePath(name);
  const parts=name.toLowerCase().split('/'),leaf=parts.at(-1);
  if(parts.some(p=>['.git','.local','.cache','.work','.pakku','node_modules'].includes(p)))throw new Error(`禁止纳管工具内部目录: ${name}`);
  if(['saves','logs','crash-reports','screenshots','assets','libraries','versions','pcl','hmcl','.minecraft'].includes(parts[0]))throw new Error(`禁止纳管玩家数据/启动器目录: ${name}`);
  if(/^\.env(?:\..*)?$/.test(leaf)||['accounts.json','launcher_accounts.json','credentials','credentials.json'].includes(leaf))throw new Error(`禁止纳管账户或凭据文件: ${name}`);
  if(parts.length===1&&['launcher_profiles.json','launcher_settings.json','hmclversion.cfg','hmcl.json','modpack.cfg','usercache.json','usernamecache.json','session.lock'].includes(leaf))throw new Error(`禁止纳管启动器/运行文件: ${name}`);
  return name;
}
export function publicContent(bytes,name) {
  const text=Buffer.from(bytes).toString('utf8');
  if(/-----BEGIN .*PRIVATE KEY-----|["']?(?:accessToken|refreshToken|curseforge_api_key)["']?\s*[:=]\s*["'][^"'\r\n]+["']/i.test(text))throw new Error(`疑似凭据: ${name}`);
}

import fs from 'node:fs/promises';
import { progress, diagnostic } from './progress.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readJson, safePath } from './workspace.mjs';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export function validateExportOutput(result) {
  requireSuccess(result);
  const text=(result.stdout+'\n'+result.stderr).replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
  const profileLines=text.split(/\r?\n/).filter(line=>/\[[^\]]+ profile\]/.test(line));
  if(!profileLines.length||profileLines.some(line=>!/\] exported to '/.test(line))||text.includes('[Migration]'))throw new Error('Pakku 导出含错误/遗漏/隐式迁移；不执行完整构建。请在隔离副本检查原生 export 输出及所需平台凭据');
  return result;
}
export async function exportPakku(root,directory,options={}) {
  return validateExportOutput(await pakku(root,directory,['export'],{...options,capture:true}));
}
export function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: options.capture ? ['ignore','pipe','pipe'] : 'inherit', cwd: options.cwd });
    let stdout = '', stderr = '';
    child.stdout?.on('data', d => { stdout += d; });
    child.stderr?.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code: code ?? 1, signal, stdout, stderr }));
  });
}
export async function tool(root) {
  const chain = await readJson(path.join(root, 'toolchain.json'));
  const p = chain.pakku;
  if (!/^\d+\.\d+\.\d+$/.test(p.version) || !/^[a-f0-9]{64}$/.test(p.sha256) || !p.url.startsWith('https://')) throw new Error('无效工具链');
  return { ...p, chain, jar: await safePath(root, `.cache/pakku-${p.version}.jar`) };
}
export async function verifiedTool(root) {
  const t = await tool(root);
  let bytes;
  try { bytes = await fs.readFile(t.jar); } catch (e) { if (e.code === 'ENOENT') throw new Error('Pakku 未安装，请运行 mp bootstrap'); throw e; }
  if (sha256(bytes) !== t.sha256) throw new Error('Pakku SHA-256 不匹配；请移走损坏缓存并重新 bootstrap');
  return t;
}
export async function bootstrap(root, download = fetch) {
  const t = await tool(root);
  try { await fs.access(t.jar); return await verifiedTool(root); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.mkdir(path.dirname(t.jar), { recursive: true });
  const partial = `${t.jar}.${randomUUID()}.part`;
  try {
    const response = await download(t.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== t.sha256) throw new Error('下载 SHA-256 不匹配');
    await fs.writeFile(partial, bytes, { flag: 'wx' });
    await fs.rename(partial, t.jar);
    return t;
  } finally { await fs.rm(partial, { force: true }); }
}
export async function pakku(root, targetPath, args, options = {}) {
  const t = await verifiedTool(root);
  // v1.5.0 Glob.walk mixes relative paths with workingPath. Absolute workingPath breaks export.
  // Set the actual cwd explicitly, then pass '.' to retain Pakku's native relative-path semantics.
  progress('pakku.wait','正在等待 Pakku 完成');
  const result = await (options.execute ?? run)(options.java ?? process.env.MP_JAVA ?? 'java', ['-Dfile.encoding=UTF-8', '-jar', t.jar, '--working-path', '.', ...args], { ...options, cwd: targetPath });
  if(options.capture)diagnostic((result.stdout??'')+(result.stderr??''));
  return result;
}
export function requireSuccess(result) {
  if (result.code !== 0) throw Object.assign(new Error(`工具退出码 ${result.code}: ${result.stderr ?? ''}`), { exitCode: result.code });
  return result;
}

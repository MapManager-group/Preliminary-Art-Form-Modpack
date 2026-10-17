import { run } from './pakku.mjs';

export function classifyProcesses(rows, gameDir) {
  let unknown = false;
  for (const row of rows) {
    const name = String(row.name ?? '').toLowerCase();
    if (!/java|minecraft/.test(name)) continue;
    const command = String(row.command ?? '').toLowerCase();
    if (!command) { unknown=true; continue; }
    if (command.includes(gameDir.toLowerCase()) || /net\.minecraft|net\.fabricmc\.loader|cpw\.mods\.(?:modlauncher|bootstraplauncher)|org\.quiltmc\.loader/.test(command)) return {status:'running',reason:'检测到游戏 Java 进程（保守匹配）'};
    if (!command.includes('pakku-') && !/hmcl|minecraftlauncher/.test(command)) unknown=true;
  }
  return {status:unknown?'unknown':'not-observed',reason:'进程快照无法保证游戏未启动；写入前仍需 --stopped 明确确认'};
}
export async function probeProcesses(gameDir) {
  try {
    if(process.platform==='win32') {
      // Keep command lines in memory only; do not log tokens or accounts from JVM arguments.
      const script = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match 'java|minecraft' } | ForEach-Object { @{name=$_.Name;command=$_.CommandLine} }) | ConvertTo-Json -Compress";
      const r=await run('pwsh',['-NoProfile','-NonInteractive','-Command',script],{capture:true});
      if(r.code!==0)throw new Error('进程查询失败');
      const rows=JSON.parse(r.stdout || '[]');return classifyProcesses(Array.isArray(rows)?rows:[rows],gameDir);
    }
    const r=await run('ps',['-eo','comm=,args='],{capture:true});
    if(r.code!==0)throw new Error('进程查询失败');
    return classifyProcesses(r.stdout.split('\n').map(line=>{const [name,...rest]=line.trim().split(/\s+/);return {name,command:rest.join(' ')};}),gameDir);
  }catch { return {status:'unknown',reason:'无法可靠查询进程，必须人工确认停止游戏并使用 --stopped'}; }
}
export async function assertStopped(gameDir,confirmed,probe=probeProcesses) {
  const result=await probe(gameDir);
  if(result.status==='running')throw new Error('游戏可能正在运行，拒绝写入；--stopped 不能绕过已检测到的进程');
  if(!confirmed)throw new Error(result.reason);
  return result;
}

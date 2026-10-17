import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

export function powerShellCandidates(env=process.env,platform=process.platform) {
  if(env.MP_PWSH)return [env.MP_PWSH];
  const names=platform==='win32'?['pwsh.exe']:['pwsh'];
  const dirs=(env.PATH??env.Path??'').split(platform==='win32'?';':':').filter(Boolean);
  return [...new Set(dirs.flatMap(dir=>names.map(name=>path.join(dir.replace(/^"|"$/g,''),name))).filter(file=>{try{fs.lstatSync(file);return true;}catch{return false;}}))];
}
export function probePowerShell({candidates=powerShellCandidates(),execute=spawnSync}={}) {
  const attempts=[];
  const script="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @{version=$PSVersionTable.PSVersion.ToString();path=(Get-Process -Id $PID).Path} | ConvertTo-Json -Compress";
  for(const executable of candidates) {
    const result=execute(executable,['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000});
    let info;
    if(!result.error&&result.status===0)try{info=JSON.parse(result.stdout.trim());}catch{}
    if(!info||typeof info.path!=='string'||!info.path||!/^\d+\.\d+/.test(info.version??'')) {
      attempts.push({path:executable,status:'unusable',reason:result.error?.message||result.stderr?.trim()||'无法读取版本'});continue;
    }
    const [major,minor]=info.version.split('.').map(Number);
    if(major<7||major===7&&minor<3){attempts.push({...info,status:'outdated'});continue;}
    return {status:'ready',...info,attempts};
  }
  const status=attempts.length?(attempts.every(a=>a.status==='outdated')?'outdated':'unusable'):'missing';
  const message={missing:'未找到 PowerShell 7.3+；请安装后加入 PATH',outdated:'PowerShell 版本低于 7.3',unusable:'PowerShell 路径存在但无法启动或读取版本；可能是不可执行的 Windows 应用别名'}[status];
  return {status,message:message+'。可用 MP_PWSH 指定实际 pwsh 可执行文件的完整路径',attempts};
}
export function menuTestOptions(probe,required=process.env.MP_REQUIRE_MENU_TESTS==='1') {
  if(probe.status==='ready')return {};
  if(required)throw new Error('CI 必须实际执行菜单测试：'+probe.message);
  return {skip:probe.message};
}

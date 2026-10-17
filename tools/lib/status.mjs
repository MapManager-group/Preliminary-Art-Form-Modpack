import { selectTarget } from './workspace.mjs';
import { runtimes, getRuntime } from './runtimes.mjs';
import { changes } from './changes.mjs';
import { run } from './pakku.mjs';
import { localPath, optionalJson } from './runtime-fs.mjs';

export async function status(root,workspace,{light=false}={}) {
  let selected=null,selectionError=null;
  try{selected=(await selectTarget(root,workspace)).id;}catch(e){selectionError=e.message;}
  const git=await run('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,capture:true});
  const reports=[];
  const bindings=(await runtimes(root)).bindings;
  for(const binding of bindings) {
    try {
      if(light) {
        const baseline=await optionalJson(await localPath(root,`runtimes/${binding.key}/baseline.json`));
        reports.push({runtime:binding.id,targetId:binding.targetId,deployed:Boolean(baseline),version:baseline?.source?.version??null,git:baseline?.source?.git??null,sourceKind:baseline?.source?.kind??null});
        continue;
      }
      const runtime=await getRuntime(root,binding.id),target=workspace.targets.find(t=>t.id===runtime.targetId);
      if(!target)throw new Error('绑定 Target 已移除');
      const report=await changes(root,runtime,target);
      reports.push({runtime:binding.id,targetId:runtime.targetId,baseline:report.baseline,pendingCollect:report.managed.filter(f=>f.state==='runtime-only').map(f=>f.path),conflicts:report.conflicts.length,candidates:report.candidates.length,dependencies:report.dependencies.length,dependencySource:report.dependencySource});
    }catch{reports.push({runtime:binding.id,targetId:binding.targetId,error:light?'本地部署元数据读取失败':'检查失败；运行 changes 查看原因'});}
  }
  return {selected,selectionError,gitDirty:git.code===0?Boolean(git.stdout.trim()):null,runtimes:reports,...(light?{light:true,targets:workspace.targets,bindings:bindings.map(({id,targetId,launcher})=>({id,targetId,launcher}))}:{})};
}

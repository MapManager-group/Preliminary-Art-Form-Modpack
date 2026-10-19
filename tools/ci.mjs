import {lintCommits} from './lint-commits.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadWorkspace,readJson,safePath} from './lib/workspace.mjs';
import {run,requireSuccess} from './lib/pakku.mjs';
import {releaseIdentity} from './lib/github.mjs';

// Keep build inputs explicit: editor settings, tests and the menu do not change exported packs.
const sharedBuildFiles=new Set(['workspace.json','toolchain.json','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','.gitignore','.gitattributes','.github/workflows/ci.yml','.github/workflows/release.yml']);
const sharedBuildInput=file=>sharedBuildFiles.has(file)||file.startsWith('tools/lib/')||['tools/mp.mjs','tools/ci.mjs','tools/release.mjs'].includes(file);
export function affectedTargets(workspace,files,all=false) {
  if(all)return workspace.targets.map(t=>t.id);
  const selected=new Set();
  for(const file of files) {
    if(/(^|\/)AGENTS\.md$/.test(file))continue;
    const target=workspace.targets.find(t=>file.startsWith(t.path+'/'));
    if(target)selected.add(target.id);
    else if(sharedBuildInput(file))return workspace.targets.map(t=>t.id);
  }
  return [...selected].sort();
}
export function needsTests(workspace,files,all=false) {
  return all||affectedTargets(workspace,files).length>0||files.some(file=>
    file==='ci.ps1'||file.startsWith('tests/')||file.startsWith('tools/')||file.startsWith('.github/workflows/')||
    ['cz.config.cjs','commitlint.config.cjs'].includes(file));
}
export async function validateTag(root,tag) {
  const workspace=await loadWorkspace(root),target=workspace.targets.find(t=>t.id===tag?.split('/')[1]);
  if(!target)throw new Error('Tag 指向未知 Target');
  const identity=releaseIdentity(tag,target.id),config=await readJson(await safePath(root,`${target.path}/pakku.json`));
  if(config.version!==identity.version)throw new Error('Tag 与 Pakku 配置版本不符');return {target,...identity};
}
export async function ciPlan(root,event,eventName) {
  const workspace=await loadWorkspace(root);
  const head=event.pull_request?.head.sha??event.after??requireSuccess(await run('git',['rev-parse','HEAD'],{cwd:root,capture:true})).stdout.trim();
  const base=event.pull_request?.base.sha??event.before;
  const all=eventName==='workflow_dispatch'||!base||/^0+$/.test(base);
  if(!/^[a-f0-9]{40}$/.test(head)||!all&&!/^[a-f0-9]{40}$/.test(base))throw new Error('事件提交 SHA 无效');
  let files=[];
  if(!all) {
    const range=event.pull_request?`${base}...${head}`:`${base}..${head}`;
    // Treat renames as deletion + addition so both targets are selected when a file moves.
    files=requireSuccess(await run('git',['diff','--no-renames','--name-only','-z',range],{cwd:root,capture:true})).stdout.split('\0').filter(Boolean);
  }
  return {targets:affectedTargets(workspace,files,all),runTests:needsTests(workspace,files,all),base:all?'':base,head,files};
}
export async function assertClean(root) {
  const result=requireSuccess(await run('git',['status','--porcelain','--untracked-files=all'],{cwd:root,capture:true}));
  if(result.stdout.trim())throw new Error(`检查产生了源文件改动或未跟踪文件：\n${result.stdout}`);
}
export async function lintCiCommits(root,{base,head='HEAD',capture=false}={}) {
  // With no base, --to reads all reachable commits, including the root commit.
  // Do not use the root as --from: Git ranges exclude their lower endpoint.
  const args=['--to',head,'--verbose'];
  if(base)args.push('--from',base);
  return lintCommits(root,args,{capture});
}
async function main() {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),command=process.argv[2];
  const emit=async values=>{console.log(JSON.stringify(values,null,2));if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,Object.entries(values).map(([k,v])=>`${k}=${typeof v==='string'?v:JSON.stringify(v)}\n`).join(''));};
  if(command==='plan') {
    const event=process.env.GITHUB_EVENT_PATH?await readJson(process.env.GITHUB_EVENT_PATH):{};
    const plan=await ciPlan(root,event,process.env.GITHUB_EVENT_NAME??'workflow_dispatch');
    await emit({matrix:{include:plan.targets.map(target=>({target}))},has_targets:String(Boolean(plan.targets.length)),run_tests:String(plan.runTests),base:plan.base,head:plan.head});
  }else if(command==='tag') {
    const {target,version}=await validateTag(root,process.env.RELEASE_TAG??process.argv[3]);await emit({target:target.id,version});
  }else if(command==='build') {
    const id=process.env.TARGET_ID??process.argv[3],target=(await loadWorkspace(root)).targets.find(t=>t.id===id);
    if(!target)throw new Error('未知 Target');
    const lock=await readJson(await safePath(root,`${target.path}/pakku-lock.json`));
    if(lock.target!=='modrinth')throw new Error('未执行完整构建：默认 CI 不接收平台 Token；当前验证范围为 Modrinth Target，其他平台需单独审核凭据流程');
    const {build}=await import('./lib/build.mjs'),result=await build(root,target);
    if(result.report.dirty||!result.report.git)throw new Error('CI/Release 构建必须来自干净 Git 提交');
    if(result.report.uncollected.length)throw new Error('存在未收集产物；请明确配置 artifacts 后重新构建');
    await emit({output:path.relative(root,result.out).split(path.sep).join('/')});
  }else if(command==='clean') {
    await assertClean(root);
  }else if(command==='lint') {
    await lintCiCommits(root,{base:process.env.COMMIT_BASE,head:process.env.COMMIT_HEAD??'HEAD'});
  }else throw new Error('ci.mjs plan|tag|build|lint|clean');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});

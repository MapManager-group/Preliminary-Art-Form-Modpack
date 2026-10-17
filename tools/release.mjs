import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safePath,readJson} from './lib/workspace.mjs';
import {digest} from './lib/prepare.mjs';
import {inspectArchive} from './lib/archive.mjs';
import {validateTag} from './ci.mjs';
import {githubClient,repository,tagCommit} from './lib/github.mjs';
import {verifyBundle} from './lib/apply.mjs';

export async function publishDraft(root,options) {
  const repo=repository(options.repo),{target,version}=await validateTag(root,options.tag);
  const directory=await safePath(root,options.directory),report=await readJson(await safePath(directory,'build-report.json'));
  if(report.targetId!==target.id||report.version!==version||report.dirty||!report.git||report.missing.length||report.uncollected.length)throw new Error('Release 报告不符合干净完整构建要求');
  if(JSON.stringify(report.artifacts.map(a=>a.kind).sort())!==JSON.stringify([...target.artifacts].sort()))throw new Error('Release 产物种类与 Target 声明不符');
  const assets=[];
  for(const artifact of report.artifacts) {
    if(artifact.name.includes('/')||artifact.name.includes('\\'))throw new Error('资产名非法');
    const bytes=await fs.readFile(await safePath(directory,artifact.name));
    if(digest(bytes)!==artifact.sha256||bytes.length!==artifact.size)throw new Error('Release 资产哈希错误');
    inspectArchive(bytes,artifact.kind);assets.push({name:artifact.name,bytes});
  }
  const reportBytes=await fs.readFile(path.join(directory,'build-report.json')),sumsBytes=await fs.readFile(path.join(directory,'SHA256SUMS'));
  const mrpack=assets.find(a=>a.name.endsWith('.mrpack'));
  if(!mrpack)throw new Error('Release 缺少 MRPACK');verifyBundle({...mrpack,reportBytes,sumsBytes},target.id);
  assets.push({name:'build-report.json',bytes:reportBytes},{name:'SHA256SUMS',bytes:sumsBytes});
  const plan={repo,tag:options.tag,target:target.id,git:report.git,draft:true,assets:assets.map(a=>({name:a.name,sha256:digest(a.bytes)}))};
  if(!options.publish)return plan;
  const {api}=githubClient(options);
  if(await tagCommit(api,repo,options.tag)!==report.git)throw new Error('远端 Tag 提交与构建不符');
  const existing=await api(`/repos/${repo}/releases/tags/${encodeURIComponent(options.tag)}`,{allowMissing:true});
  if(existing)throw new Error('此 Tag 已存在 Release（含草稿），拒绝覆盖；请人工审查已有状态');
  const created=await api(`/repos/${repo}/releases`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag_name:options.tag,target_commitish:report.git,name:`${target.id} v${version}`,draft:true,prerelease:version.includes('-'),body:`待人工审核的模板构建。\nTarget: ${target.id}\nCommit: ${report.git}\n校验 SHA256SUMS 和 build-report.json 后再手动发布。`})});
  if(!created.draft||!Number.isSafeInteger(created.id))throw new Error('未得到预期 Draft Release');
  for(const asset of assets) {
    // Fixed API host; never use an unvalidated response upload_url or overwrite/clobber assets.
    const response=await (options.fetch??fetch)(`https://uploads.github.com/repos/${repo}/releases/${created.id}/assets?name=${encodeURIComponent(asset.name)}`,{method:'POST',headers:{Authorization:`Bearer ${options.token??process.env.GH_TOKEN??process.env.GITHUB_TOKEN}`,'Content-Type':'application/octet-stream','X-GitHub-Api-Version':'2022-11-28'},body:asset.bytes,redirect:'error',signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error(`上传失败 HTTP ${response.status}；草稿保留，需人工处理，不自动发布或重建`);
    const uploaded=await response.json();if(uploaded.digest!==`sha256:${digest(asset.bytes)}`)throw new Error('上传后 digest 不符，草稿保留待排查');
  }
  return {...plan,id:created.id};
}
async function main() {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const result=await publishDraft(root,{repo:process.env.GITHUB_REPOSITORY,tag:process.env.RELEASE_TAG,directory:process.env.RELEASE_DIRECTORY,publish:process.argv.includes('--publish')});console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});

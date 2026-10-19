import {inspectZip} from './archive.mjs';
import {digest} from './prepare.mjs';
import {isTargetId} from './workspace.mjs';

export function repository(value) {
  if(!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(value??'')||value.split('/').some(s=>s==='.'||s==='..'))throw new Error('需要明确 --repo owner/repository');return value;
}
// Keep version strings intact; only the SemVer tag marker "v" is removed.
export function releaseIdentity(tag,targetId) {
  const m=typeof tag==='string'?tag.match(/^release\/([^/]+)\/([^/]+)$/):null;
  const invalid=()=>{throw new Error('Release Tag 必须为 release/<target>/a<整数>.<整数>、b<整数>.<整数> 或 v<SemVer>');};
  if(!m||tag.trim()!==tag||!isTargetId(m[1])||m[1]!==targetId)return invalid();
  const label=m[2];
  if(/^[ab](0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(label))return {version:label,label,prerelease:true};
  // SemVer 2.0.0: numeric prerelease identifiers cannot have leading zeroes.
  const semver=label.match(/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
  if(!semver||semver[4]?.split('.').some(id=>/^[0-9]+$/.test(id)&&id.length>1&&id[0]==='0'))return invalid();
  return {version:label.slice(1),label,prerelease:semver[4]!==undefined};
}
export function releaseTag(tag,targetId) {return releaseIdentity(tag,targetId).version;}
export function githubClient(options={}) {
  const request=options.fetch??fetch,token=options.token??process.env.GH_TOKEN??process.env.GITHUB_TOKEN;
  const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:`Bearer ${token}`}:{})};
  const api=async(route,init={})=>{
    const response=await request(`https://api.github.com${route}`,{...init,headers:{...headers,...init.headers},redirect:'error',signal:AbortSignal.timeout(120000)});
    if(response.status===404 && init.allowMissing)return null;
    if(!response.ok)throw new Error(`GitHub HTTP ${response.status}；检查仓库/运行权限和 GH_TOKEN，或改用 --file 离线入口`);
    return response.status===204?null:response.json();
  };
  const download=async(route)=>{
    let response=await request(`https://api.github.com${route}`,{headers:{...headers,Accept:'application/octet-stream'},redirect:'manual',signal:AbortSignal.timeout(120000)});
    if([301,302,303,307,308].includes(response.status)) {
      const location=new URL(response.headers.get('location'));
      if(location.protocol!=='https:'||location.username||location.password||!['github.com','githubusercontent.com','blob.core.windows.net','actions.githubusercontent.com'].some(d=>location.hostname===d||location.hostname.endsWith('.'+d)))throw new Error('GitHub 下载跳转地址不可信');
      response=await request(location,{redirect:'error',signal:AbortSignal.timeout(120000)}); // Never forward token to storage.
    }
    if(!response.ok)throw new Error(`GitHub 下载 HTTP ${response.status}；检查认证/过期状态，或使用 --file`);
    const chunks=[];let total=0;
    for await(const chunk of response.body){total+=chunk.length;if(total>512*1024*1024)throw new Error('下载超过 512 MiB');chunks.push(chunk);}
    return Buffer.concat(chunks);
  };
  return {api,download};
}
export async function tagCommit(api,repo,tag) {
  let ref=await api(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`),object=ref.object;
  for(let i=0;object.type==='tag'&&i<5;i++)object=(await api(`/repos/${repo}/git/tags/${object.sha}`)).object;
  if(object.type!=='commit'||!/^[a-f0-9]{40}$/.test(object.sha))throw new Error('Tag 未指向确定提交');return object.sha;
}
export async function downloadArtifact(targetId,options={}) {
  const repo=repository(options.repo),{api,download}=githubClient(options);
  if(options.run) {
    if(!/^[1-9][0-9]*$/.test(String(options.run)))throw new Error('Run ID 无效');
    const run=await api(`/repos/${repo}/actions/runs/${options.run}`);
    if(run.id!==Number(options.run)||run.repository?.full_name?.toLowerCase()!==repo.toLowerCase()||run.path!=='.github/workflows/ci.yml'||run.status!=='completed'||run.conclusion!=='success'||!/^[a-f0-9]{40}$/.test(run.head_sha))throw new Error('必须指定本仓库 ci.yml 的成功运行');
    const artifacts=[];
    for(let page=1;page<=20;page++) {
      const list=await api(`/repos/${repo}/actions/runs/${options.run}/artifacts?per_page=100&page=${page}`);
      artifacts.push(...list.artifacts);if(artifacts.length>=list.total_count)break;if(page===20)throw new Error('Artifact 分页过多');
    }
    const matches=artifacts.filter(a=>a.name===`preview-${targetId}`&&!a.expired);
    if(matches.length!==1)throw new Error('缺少唯一未过期 Target Artifact（纯文档运行不会构建）');
    const item=matches[0];
    if(!Number.isSafeInteger(item.id)||item.workflow_run?.head_sha!==run.head_sha)throw new Error('Artifact 来源提交不符');
    const bytes=await download(`/repos/${repo}/actions/artifacts/${item.id}/zip`);
    if(item.digest!==`sha256:${digest(bytes)}`)throw new Error('GitHub Artifact ZIP digest 不符/缺失');
    const entries=inspectZip(bytes),names=Object.keys(entries).filter(n=>n.endsWith('.mrpack'));
    if(names.length!==1||names[0].includes('/')||!entries['build-report.json']||!entries.SHA256SUMS)throw new Error('Artifact 结构错误');
    const report=JSON.parse(Buffer.from(entries['build-report.json']).toString('utf8'));
    if(!Array.isArray(report.artifacts))throw new Error('Artifact 缺少产物清单');
    const allowed=new Set(['build-report.json','SHA256SUMS',...report.artifacts.map(a=>a.name)]);
    if(Object.keys(entries).some(n=>!allowed.has(n)))throw new Error('Artifact 包含未声明内容');
    for(const asset of report.artifacts)if(!entries[asset.name]||digest(entries[asset.name])!==asset.sha256||entries[asset.name].length!==asset.size)throw new Error('Artifact 产物遗漏或哈希不符');
    return {name:names[0],bytes:entries[names[0]],reportBytes:entries['build-report.json'],sumsBytes:entries.SHA256SUMS,provenance:{kind:'ci',repo,run:String(run.id),git:run.head_sha,event:run.event}};
  }
  const version=releaseTag(options.release,targetId);
  const release=await api(`/repos/${repo}/releases/tags/${encodeURIComponent(options.release)}`);
  if(release.tag_name!==options.release)throw new Error('Release Tag 不符');
  const names=release.assets.filter(a=>a.name.endsWith('.mrpack'));
  if(names.length!==1)throw new Error('Release 必须包含唯一 MRPACK');
  const read=async name=>{
    const assets=release.assets.filter(a=>a.name===name);if(assets.length!==1||!Number.isSafeInteger(assets[0].id))throw new Error('Release 缺少唯一产物');
    const asset=assets[0],bytes=await download(`/repos/${repo}/releases/assets/${asset.id}`);
    if(asset.digest!==`sha256:${digest(bytes)}`)throw new Error('Release 资产 digest 不符/缺失');return bytes;
  };
  const git=await tagCommit(api,repo,options.release);
  const bundle={name:names[0].name,bytes:await read(names[0].name),reportBytes:await read('build-report.json'),sumsBytes:await read('SHA256SUMS'),provenance:{kind:'release',repo,tag:options.release,git,draft:release.draft}};
  if(JSON.parse(Buffer.from(bundle.reportBytes).toString('utf8')).version!==version)throw new Error('Release 版本与构建报告不符');
  return bundle;
}

import { progress } from './progress.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectArchive } from './archive.mjs';
import { safePath, relativePath } from './workspace.mjs';
import { sourceSnapshot, clientManifest, digest, validateDownload } from './prepare.mjs';
import { deploy } from './deploy.mjs';
import { verifyRuntime } from './runtimes.mjs';
import { matchVersion } from './launcher.mjs';
import { absoluteDirectory } from './runtime-fs.mjs';
import { downloadArtifact } from './github.mjs';
import { verifiedTool } from './pakku.mjs';

export function verifyBundle(bundle,targetId) {
  const {name,bytes,reportBytes,sumsBytes}=bundle;
  relativePath(name);if(name.includes('/')||!name.endsWith('.mrpack'))throw new Error('必须是单一 MRPACK 文件名');
  const sums=new Map();
  for(const line of Buffer.from(sumsBytes).toString('utf8').trim().split(/\r?\n/)) {
    const match=line.match(/^([a-f0-9]{64})  ([^/\\]+)$/);if(!match||sums.has(match[2]))throw new Error('SHA256SUMS 格式/重复条目错误');
    relativePath(match[2]);sums.set(match[2],match[1]);
  }
  if(sums.get(name)!==digest(bytes)||sums.get('build-report.json')!==digest(reportBytes))throw new Error('包或构建报告 SHA256 不符');
  const report=JSON.parse(Buffer.from(reportBytes).toString('utf8'));
  if(report.schema!==1||report.targetId!==targetId||typeof report.dirty!=='boolean'||!Array.isArray(report.artifacts)||!Array.isArray(report.missing)||report.missing.length||!Array.isArray(report.uncollected))throw new Error('构建报告身份/完整性无效');
  for(const field of ['sourceFingerprint','lockHash','configHash'])if(!/^[a-f0-9]{64}$/.test(report[field]??''))throw new Error('构建报告摘要无效');
  if(report.git!==null&&!/^[a-f0-9]{40}$/.test(report.git??''))throw new Error('构建报告 Git SHA 无效');
  const seen=new Set();
  for(const item of report.artifacts) {
    relativePath(item.name);if(item.name.includes('/')||seen.has(item.name)||sums.get(item.name)!==item.sha256||!Number.isSafeInteger(item.size)||item.size<0)throw new Error('构建产物清单无效');seen.add(item.name);
  }
  if(sums.size!==seen.size+1)throw new Error('哈希清单包含未声明文件');
  const artifact=report.artifacts.find(a=>a.name===name);
  if(!artifact||artifact.kind!=='modrinth'||artifact.sha256!==digest(bytes)||artifact.size!==bytes.length)throw new Error('构建报告中的产物不匹配');
  return report;
}
export async function localBundle(file) {
  const absolute=path.resolve(file),dir=await absoluteDirectory(path.dirname(absolute)),name=path.basename(absolute);
  const read=async n=>{const f=await safePath(dir,n),s=await fs.lstat(f);if(!s.isFile()||s.nlink!==1||s.size>512*1024*1024)throw new Error('导入必须是独立普通文件且不超过 512 MiB');return fs.readFile(f);};
  return {name,bytes:await read(name),reportBytes:await read('build-report.json'),sumsBytes:await read('SHA256SUMS')};
}
export async function apply(root,runtime,target,options={}) {
  if(Boolean(options.file)===Boolean(options.run||options.release)||options.run&&options.release)throw new Error('指定且仅指定 --file、--run 或 --release');
  if(options.dryRun && options.confirm)throw new Error('--dry-run 与 --confirm 冲突');
  if(options.file && options.repo)throw new Error('--repo 仅用于远端来源');
  progress('apply.read','正在读取构建包与来源报告');
  const bundle=options.file?await localBundle(options.file):await downloadArtifact(target.id,options);
  progress('apply.verify','正在校验构建包、哈希与目标兼容性');
  const report=verifyBundle(bundle,target.id),packageHash=digest(bundle.bytes);
  const snapshot=await sourceSnapshot(root,target);
  if(report.toolchain?.pakku?.version!==snapshot.pakku||report.toolchain?.pakku?.sha256!==(await verifiedTool(root)).sha256)throw new Error('包工具版本/校验信息与模板不符');
  const entries=inspectArchive(bundle.bytes,'modrinth'),index=JSON.parse(new TextDecoder().decode(entries['modrinth.index.json']));
  if(index.versionId!==report.version)throw new Error('包版本与报告不符');
  const equal=(a,b)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
  if(!equal(index.dependencies,report.dependencies))throw new Error('包依赖与报告不符');
  const loaders={};for(const [key,value] of Object.entries(index.dependencies)) {
    if(typeof value!=='string'||!value)throw new Error('包依赖版本无效');
    if(key==='minecraft')continue;
    if(!['fabric-loader','quilt-loader','forge','neoforge'].includes(key))throw new Error('包含未知加载器');
    loaders[{'fabric-loader':'fabric','quilt-loader':'quilt'}[key]??key]=value;
  }
  matchVersion(await verifyRuntime(root,runtime,target),{mc_versions:[index.dependencies.minecraft],loaders});
  const paths=new Set();
  for(const dep of index.files) {validateDownload(dep);const key=dep.path.toLowerCase();if(paths.has(key))throw new Error('索引重复路径');paths.add(key);if(dep.env?.server && !['required','optional','unsupported'].includes(dep.env.server))throw new Error('未知服务端侧别');}
  // Remote snapshots may differ from local sources. Never invent Collect mappings for them.
  const sameSource=snapshot.fingerprint===report.sourceFingerprint;
  const manifest=clientManifest(entries,sameSource?snapshot:{mapping:[],hashes:{}}),content={};
  for(const file of manifest.files.filter(f=>f.kind!=='dependency')) {
    content[file.hash]=entries[file.archivePath];
    if(!sameSource&&!file.path.toLowerCase().endsWith('.jar')){file.kind='override';file.source=`artifact:${file.archivePath}`;}
  }
  const provenance={kind:'file',packageHash,...bundle.provenance};
  if(provenance.kind!=='file'&&(report.dirty||!report.git||report.git!==provenance.git))throw new Error('远端来源与干净构建提交不符');
  const prepared={schema:1,targetId:target.id,fingerprint:report.sourceFingerprint,pakku:snapshot.pakku,version:report.version,git:report.git,dirty:report.dirty,lockHash:report.lockHash,configHash:report.configHash,...manifest,content,provenance};
  options.report?.({action:'apply',target:target.id,version:report.version,git:report.git,dirty:report.dirty,provenance,files:prepared.files.map(f=>({path:f.path,hash:f.hash})),notice:'包可能包含可执行 Mod；预览后使用 --sha256 <packageHash> --confirm --stopped，工具不启动游戏'});
  if(options.sha256 && options.sha256!==packageHash)throw new Error('指定 SHA256 与包不符');
  if(options.confirm && options.sha256!==packageHash)throw new Error('真实 Apply 必须 --sha256 明确确认本次审查的包');
  return deploy(root,runtime,target,{...options,prepared,dryRun:!options.confirm,verifyPrepared:async()=>{
    if((await sourceSnapshot(root,target)).fingerprint!==snapshot.fingerprint)throw new Error('Apply 期间本地源改变');
    if(options.file) {const latest=await localBundle(options.file);if(digest(latest.bytes)!==packageHash||digest(latest.reportBytes)!==digest(bundle.reportBytes)||digest(latest.sumsBytes)!==digest(bundle.sumsBytes))throw new Error('Apply 期间导入文件改变');}
  }});
}

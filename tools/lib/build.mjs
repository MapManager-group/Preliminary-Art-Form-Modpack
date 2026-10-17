import { progress } from './progress.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { safePath, filesUnder } from './workspace.mjs';
import { checkTarget } from './check.mjs';
import { exportPakku, sha256, run, verifiedTool } from './pakku.mjs';
import { inspectArchive } from './archive.mjs';
import { clientManifest, sourceSnapshot, validateDownload } from './prepare.mjs';
export { inspectArchive } from './archive.mjs';

export async function build(root, target, options = {}) {
  progress('build.check','正在检查构建目标');
  const info = await checkTarget(root, target, options);
  const snapshot=await sourceSnapshot(root,target);
  const workRoot = await safePath(root, '.work');
  await fs.mkdir(workRoot, { recursive: true });
  const work = await fs.mkdtemp(path.join(workRoot, `${target.id}-`));
  // Copy only inspected source, never local credentials or generated Pakku data.
  for (const file of info.source) {
    const dest = path.join(work, file);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(info.dir, file), dest);
  }
  await exportPakku(root,work,options);
  progress('build.verify','正在校验构建产物');
  const files = await filesUnder(work);
  const found = files.filter(f => f.startsWith('build/') && !f.startsWith('build/.cache/') && /\.(mrpack|zip)$/.test(f));
  const artifacts = [];
  for (const kind of target.artifacts) {
    const matches = found.filter(f => f.startsWith(`build/${kind}/`) && f.endsWith(kind === 'modrinth' ? '.mrpack' : '.zip'));
    if (matches.length !== 1) throw new Error(`${kind} 期望 1 份产物，实际 ${matches.length}。准备区: ${work}`);
    const bytes = await fs.readFile(path.join(work, matches[0]));
    const entries=inspectArchive(bytes, kind);
    if(kind==='modrinth') {
      const index=JSON.parse(new TextDecoder().decode(entries['modrinth.index.json']));
      for(const dep of index.files)validateDownload(dep);
      clientManifest(entries,snapshot);
      for(const mapping of info.mapping) {
        if(!entries[mapping.archivePath]||sha256(entries[mapping.archivePath])!==snapshot.hashes[mapping.source])throw new Error(`导出遗漏/修改覆盖资源: ${mapping.source}`);
      }
    }
    if(kind==='curseforge') {
      const expected=new Map();
      for(const side of ['common','client'])for(const mapping of info.mapping.filter(m=>m.side===side))expected.set(mapping.destination,mapping.source);
      for(const [destination,source] of expected)if(!entries['overrides/'+destination]||sha256(entries['overrides/'+destination])!==snapshot.hashes[source])throw new Error(`CurseForge 导出遗漏/修改覆盖资源: ${source}`);
    }
    if(kind==='serverpack') {
      const expected=new Map();
      for(const side of ['common','server'])for(const mapping of info.mapping.filter(m=>m.side===side))expected.set(mapping.destination,mapping.source);
      for(const [destination,source] of expected)if(!entries[destination]||sha256(entries[destination])!==snapshot.hashes[source])throw new Error(`服务端导出遗漏/修改覆盖资源: ${source}`);
    }
    const originalName=path.basename(matches[0]);
    const name=artifacts.some(a=>a.name===originalName)?`${kind}-${originalName}`:originalName;
    artifacts.push({ kind, name, source:matches[0], bytes });
  }
  if((await sourceSnapshot(root,target)).fingerprint!==snapshot.fingerprint)throw new Error('构建期间源改变，拒绝发布');
  // Unique run directory avoids stale products being mistaken for this build.
  progress('build.save','正在保存构建产物与报告');
  const outRoot = await safePath(root, `dist/${target.id}`);
  await fs.mkdir(outRoot, { recursive: true });
  const out = await fs.mkdtemp(path.join(outRoot, 'build-'));
  for (const artifact of artifacts) await fs.writeFile(path.join(out, artifact.name), artifact.bytes, { flag: 'wx' });
  const revision=await run('git',['rev-parse','HEAD'],{cwd:root,capture:true});
  const git=revision.code===0?revision.stdout.trim():null;
  const state=await run('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,capture:true});
  const tool=await verifiedTool(root);
  const report={schema:1,targetId:target.id,version:info.config.version,git,dirty:state.code!==0||Boolean(state.stdout.trim()),sourceFingerprint:snapshot.fingerprint,lockHash:snapshot.hashes['pakku-lock.json'],configHash:snapshot.hashes['pakku.json'],toolchain:tool.chain,dependencies:{minecraft:info.lock.mc_versions[0],...Object.fromEntries(Object.entries(info.lock.loaders).map(([k,v])=>[{'fabric':'fabric-loader','quilt':'quilt-loader'}[k]??k,v]))},artifacts:artifacts.map(({kind,name,bytes})=>({kind,name,sha256:sha256(bytes),size:bytes.length})),missing:[],uncollected:found.filter(f=>!artifacts.some(a=>a.source===f)),mapping:info.mapping};
  await fs.writeFile(path.join(out,'build-report.json'),JSON.stringify(report,null,2)+'\n');
  const hashes=[...report.artifacts.map(a=>`${a.sha256}  ${a.name}`),`${sha256(await fs.readFile(path.join(out,'build-report.json')))}  build-report.json`];
  await fs.writeFile(path.join(out,'SHA256SUMS'),hashes.join('\n')+'\n');
  console.log(JSON.stringify({target:target.id,output:out,...report},null,2));
  return { out, artifacts,report };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {isTargetId,loadWorkspace,safePath,readJson,filesUnder} from './workspace.mjs';
import {inspectArchive} from './archive.mjs';
import {pakku,requireSuccess,exportPakku,sha256} from './pakku.mjs';
import {checkTarget} from './check.mjs';
import {validateDownload} from './prepare.mjs';
import {managedPath,lockOperation} from './runtime-fs.mjs';
import {progress} from './progress.mjs';

const platforms=['modrinth','curseforge','multiplatform'];
const loaders=['fabric','forge','neoforge','quilt'];
const filename=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&!/[\\/:*?"<>|\x00-\x1f]/.test(value);
const version=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(value);
const exists=async file=>{try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const hashFiles=async dir=>Object.fromEntries(await Promise.all((await filesUnder(dir)).map(async name=>[name,sha256(await fs.readFile(await safePath(dir,name)))])));
const jsonWrite=(file,data)=>fs.writeFile(file,JSON.stringify(data,null,2)+'\n');
const envOf=file=>({client:file.env?.client??'required',server:file.env?.server??'required'});

export async function inspectPack(file) {
  if(typeof file!=='string'||!file.toLowerCase().endsWith('.mrpack'))throw new Error('需要本地 .mrpack 文件');
  const absolute=path.resolve(file),safe=await safePath(path.dirname(absolute),path.basename(absolute));
  const stat=await fs.lstat(safe);
  if(!stat.isFile()||stat.nlink!==1||stat.size>512*1024*1024)throw new Error('MRPACK 必须是独立普通文件且不超过 512 MiB');
  const bytes=await fs.readFile(safe),entries=inspectArchive(bytes,'modrinth');
  const index=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(entries['modrinth.index.json']));
  if(typeof index.name!=='string'||!index.name.trim()||!filename(index.versionId)||!version(index.dependencies.minecraft)||index.summary!==undefined&&typeof index.summary!=='string')throw new Error('MRPACK 名称、版本或 Minecraft 元数据无效');
  const loaderEntries=Object.entries(index.dependencies).filter(([key])=>key!=='minecraft');
  const normalized=loaderEntries.map(([key,value])=>[{'fabric-loader':'fabric','quilt-loader':'quilt',forge:'forge',neoforge:'neoforge'}[key],value]);
  if(normalized.length!==1||normalized.some(([key,value])=>!key||!version(value)))throw new Error('仅支持一个已知 Loader（Fabric / Forge / NeoForge / Quilt）');
  const issues=[],skipped=[],overrides=[],seen=new Set();
  for(const key of Object.keys(index))if(!['formatVersion','game','versionId','name','summary','files','dependencies'].includes(key))issues.push({path:'modrinth.index.json',reason:'未知索引字段: '+key});
  for(const item of index.files) {
    validateDownload(item);
    if(Object.keys(item).some(key=>!['path','hashes','env','downloads','fileSize'].includes(key))||Object.keys(item.env??{}).some(key=>!['client','server'].includes(key)))issues.push({path:item.path,reason:'包含无法保留的非标准依赖字段'});
    if(seen.has(item.path.toLowerCase()))throw new Error('MRPACK 依赖路径重复');seen.add(item.path.toLowerCase());
    const env=envOf(item);
    if(Object.values(env).some(side=>!['required','optional','unsupported'].includes(side)))throw new Error('MRPACK 侧别无效');
    if(Object.values(env).includes('optional'))issues.push({path:item.path,reason:'Pakku 1.5.0 无法无损表达 optional 侧别，请先明确是否必需'});
    if(Object.values(env).every(side=>side==='unsupported'))issues.push({path:item.path,reason:'客户端和服务端均不支持'});
  }
  for(const [name,data] of Object.entries(entries)) {
    if(name==='modrinth.index.json')continue;
    if(name.endsWith('/')) {skipped.push({path:name,reason:'空目录记录不作为源文件保存'});continue;}
    const [,folder,relative]=name.match(/^(overrides|client-overrides|server-overrides)\/(.+)$/);
    const destination=`.pakku/${folder}/${relative}`;
    managedPath(relative);
    overrides.push({path:name,destination,hash:sha256(data)});
    if(index.files.some(item=>item.path.toLowerCase()===relative.toLowerCase()))issues.push({path:name,reason:'覆盖文件遮蔽索引依赖，不能无损转换'});
  }
  return {action:'inspect-pack',file:absolute,hash:sha256(bytes),name:index.name,version:index.versionId,mc:index.dependencies.minecraft,loader:normalized[0][0],loaderVersion:normalized[0][1],platforms:['modrinth'],dependencies:index.files.length,overrides,skipped,issues,index,entries};
}
export function packSummary(pack) {const {index,entries,...report}=pack;return report;}

async function request(root,id,options) {
  if(!isTargetId(id))throw new Error('Target ID 仅允许小写字母、数字、点和连字符');
  managedPath(`packs/${id}`);
  const workspace=await loadWorkspace(root),workspaceFile=await safePath(root,'workspace.json');
  const workspaceBytes=await fs.readFile(workspaceFile);
  if(!isDeepStrictEqual(JSON.parse(workspaceBytes),workspace))throw new Error('读取期间工作区已变化');
  const target={id,path:`packs/${id}`,artifacts:options.platform==='curseforge'?['curseforge','serverpack']:options.platform==='multiplatform'?['modrinth','curseforge','serverpack']:['modrinth','serverpack']};
  if(workspace.targets.some(t=>t.id===id||t.path.toLowerCase()===target.path||t.path.toLowerCase().startsWith(target.path+'/')||target.path.startsWith(t.path.toLowerCase()+'/')))throw new Error('Target ID 或目录已注册/嵌套');
  if(await exists(await safePath(root,target.path)))throw new Error('目标目录已存在，不覆盖');
  if(!filename(options.name)||!platforms.includes(options.platform))throw new Error('需要合法的工程名称与发布平台');
  const pack=options.file?await inspectPack(options.file):null;
  if(pack&&options.platform!=='modrinth')throw new Error('MRPACK 转换目前仅支持 Modrinth；跨平台匹配不能保证版本与文件一致');
  if(pack&&[options.mc,options.loader,options.loaderVersion].some(v=>v!==undefined))throw new Error('导入使用原 MRPACK 的 Minecraft / Loader，不接受覆盖');
  const spec={name:options.name,platform:options.platform,version:pack?.version??'0.1.0',mc:pack?.mc??options.mc,loader:pack?.loader??options.loader,loaderVersion:pack?.loaderVersion??options.loaderVersion};
  if(!version(spec.mc)||!loaders.includes(spec.loader)||!version(spec.loaderVersion))throw new Error('需要 Minecraft 版本、Loader 及其版本');
  const record={schema:1,target,spec,workspaceHash:sha256(workspaceBytes),input:pack?{file:pack.file,hash:pack.hash}:null};
  return {record,pack,workspace};
}
const reviewHash=record=>sha256(Buffer.from(JSON.stringify(record)));
function summary(record,extra={}) {
  return {action:'create-project',mode:record.input?'mrpack':'blank',target:record.target.id,directory:record.target.path,...record.spec,dependencies:0,converted:[],skipped:[],issues:[],overrides:[],blocked:false,...extra};
}
async function initialize(root,dir,spec,options) {
  progress('create.init','正在用 Pakku 初始化隔离工程');
  requireSuccess(await pakku(root,dir,['--yes','init','--name',spec.name,'--version',spec.version,'--mc-versions',spec.mc,'--loaders',`${spec.loader}=${spec.loaderVersion}`,'--target',spec.platform],{...options,capture:true}));
  const config=await readJson(path.join(dir,'pakku.json'));
  // init adds an unmatched config directory by default. Manual overrides are used here.
  config.overrides=[];
  await jsonWrite(path.join(dir,'pakku.json'),config);
}
async function validateProject(root,target,spec,options) {
  const info=await checkTarget(root,target,options);
  if(info.config.name!==spec.name||info.config.version!==spec.version||info.lock.target!==spec.platform||!isDeepStrictEqual(info.lock.mc_versions,[spec.mc])||!isDeepStrictEqual(info.lock.loaders,{[spec.loader]:spec.loaderVersion}))throw new Error('Pakku 工程元数据与确认信息不符');
  return info;
}
async function convert(root,dir,relative,pack,spec,options) {
  const report={dependencies:pack.dependencies,converted:[],skipped:pack.skipped,issues:[...pack.issues],overrides:pack.overrides};
  if(report.issues.length)return report;
  const manifest=path.join(path.dirname(dir),'modrinth.index.json');
  await jsonWrite(manifest,pack.index);
  progress('create.import','正在由 Pakku 按哈希识别 MRPACK 依赖');
  requireSuccess(await pakku(root,dir,['--yes','import',manifest],{...options,capture:true}));
  const lock=await readJson(path.join(dir,'pakku-lock.json')),used=new Set();
  for(const item of pack.index.files) {
    const matches=(lock.projects??[]).filter(p=>(p.files??[]).some(f=>f.type==='modrinth'&&f.hashes?.sha512===item.hashes.sha512&&f.hashes?.sha1===item.hashes.sha1));
    if(matches.length!==1||!matches[0].id?.modrinth||used.has(matches[0].pakku_id)) {
      report.issues.push({path:item.path,reason:'Pakku 未唯一识别相同哈希的项目，或同一项目有多个文件/版本；需人工处理'});continue;
    }
    const project=matches[0],file=project.files.find(f=>f.type==='modrinth'&&f.hashes?.sha512===item.hashes.sha512);
    if(file.mc_versions?.length&&!file.mc_versions.includes(spec.mc)||file.loaders?.length&&!file.loaders.includes(spec.loader)) {
      report.issues.push({path:item.path,reason:'识别依赖的 Minecraft / Loader 不兼容'});continue;
    }
    used.add(project.pakku_id);
    const env=envOf(item),side=env.client==='unsupported'?'SERVER':env.server==='unsupported'?'CLIENT':'BOTH';
    requireSuccess(await pakku(root,dir,['cfg','prj','--side',side,'--update-strategy','NONE',project.id.modrinth],{...options,capture:true}));
    report.converted.push({path:item.path,project:project.name?.modrinth??project.id.modrinth});
  }
  if((lock.projects??[]).some(project=>!used.has(project.pakku_id)))report.issues.push({path:'pakku-lock.json',reason:'Pakku 产生原索引未包含的依赖，不接受隐式增删'});
  if(report.issues.length)return report;
  const config=await readJson(path.join(dir,'pakku.json'));
  config.description=typeof pack.index.summary==='string'?pack.index.summary:'';
  config.export_server_side_projects_to_client=false; // SERVER remains client=unsupported in Pakku 1.5.0.
  await jsonWrite(path.join(dir,'pakku.json'),config);
  for(const item of pack.overrides) {
    const dest=await safePath(dir,item.destination);await fs.mkdir(path.dirname(dest),{recursive:true});
    await fs.writeFile(dest,pack.entries[item.path],{flag:'wx'});
  }
  await validateProject(root,{id:'candidate',path:relative},spec,options);
  progress('create.verify','正在导出候选并核对依赖、侧别与覆盖文件');
  await exportPakku(root,dir,options);
  const names=(await filesUnder(dir)).filter(name=>name.startsWith('build/modrinth/')&&name.endsWith('.mrpack'));
  if(names.length!==1)throw new Error('Pakku 未生成唯一验证包');
  const output=inspectArchive(await fs.readFile(path.join(dir,names[0])),'modrinth');
  const index=JSON.parse(new TextDecoder().decode(output['modrinth.index.json']));
  if(!isDeepStrictEqual(index.dependencies,pack.index.dependencies))report.issues.push({path:'modrinth.index.json',reason:'导出 Minecraft / Loader 元数据发生变化'});
  const normalize=files=>files.map(f=>({path:f.path,hashes:f.hashes,fileSize:f.fileSize,env:envOf(f)})).sort((a,b)=>a.path.localeCompare(b.path));
  if(!isDeepStrictEqual(normalize(index.files),normalize(pack.index.files)))report.issues.push({path:'modrinth.index.json',reason:'导出依赖的路径、哈希、大小或侧别与原包不同，无法无损转换'});
  const expected=Object.fromEntries(pack.overrides.map(item=>[item.path,item.hash]));
  const actual=Object.fromEntries(Object.entries(output).filter(([name])=>name!=='modrinth.index.json'&&!name.endsWith('/')).map(([name,bytes])=>[name,sha256(bytes)]));
  if(!isDeepStrictEqual(expected,actual))report.issues.push({path:'overrides',reason:'导出覆盖文件与原包不一致，无法无损转换'});
  // Keep candidate source only; artifacts and downloaded JARs never move into packs/.
  const info=await checkTarget(root,{id:'candidate',path:relative},options);
  for(const name of await filesUnder(dir))if(!info.source.includes(name))await fs.unlink(await safePath(dir,name));
  return report;
}
async function publish(root,record,dir,options) {
  const dest=await safePath(root,record.target.path),workspaceFile=await safePath(root,'workspace.json');
  if(sha256(await fs.readFile(workspaceFile))!==record.workspaceHash)throw new Error('workspace.json 已变化，请重新预览');
  if(record.input&&(await inspectPack(record.input.file)).hash!==record.input.hash)throw new Error('原 MRPACK 已变化，请重新预览');
  const expected=record.files??await hashFiles(dir);
  if(!isDeepStrictEqual(await hashFiles(dir),expected))throw new Error('注册前候选已变化');
  const workspace=await loadWorkspace(root),created=[];
  let owned=false,committed=false;
  try {
    // Exclusive directory creation reserves this Target without replacing an existing directory.
    await fs.mkdir(dest);owned=true;
    for(const name of (await checkTarget(root,{id:record.target.id,path:path.relative(root,dir).replaceAll('\\','/')},options)).source) {
      const file=await safePath(dest,name);await fs.mkdir(path.dirname(file),{recursive:true});
      await fs.copyFile(await safePath(dir,name),file,fs.constants.COPYFILE_EXCL);created.push(name);
    }
    await validateProject(root,record.target,record.spec,options);
    if(!isDeepStrictEqual(await hashFiles(dest),expected))throw new Error('复制期间候选或目标文件已变化');
    await options.beforeRegister?.();
    if(sha256(await fs.readFile(workspaceFile))!==record.workspaceHash)throw new Error('注册前 workspace.json 已变化，请重新预览');
    workspace.targets.push(record.target);
    const temp=await safePath(root,`.workspace-create-${randomUUID()}.tmp`);
    try {
      await jsonWrite(temp,workspace);await options.beforeCommit?.();
      if(sha256(await fs.readFile(workspaceFile))!==record.workspaceHash)throw new Error('提交前 workspace.json 已变化');
      await fs.rename(temp,workspaceFile);committed=true;
    } finally {await fs.rm(temp,{force:true});}
  } finally {
    if(owned&&!committed) {
      // Delete only files we created. Preserve unexpected concurrent content.
      for(const name of created.reverse())await fs.unlink(await safePath(dest,name));
      const clean=async directory=>{for(const item of await fs.readdir(directory,{withFileTypes:true}))if(item.isDirectory())await clean(await safePath(directory,item.name));await fs.rmdir(directory).catch(e=>{if(e.code!=='ENOTEMPTY')throw e;});};
      await clean(dest);
    }
  }
}
export async function createProject(root,id,options={}) {
  if(options.candidate) {
    if(!options.confirm||!/^[a-f0-9-]{36}$/.test(options.candidate)||!options.acceptHash)throw new Error('接受工程候选需要 --confirm --candidate --accept-hash');
    if(['file','name','platform','mc','loader','loaderVersion'].some(key=>options[key]!==undefined))throw new Error('接受候选不能同时指定初始化参数');
    const base=await safePath(root,`.work/create-${options.candidate}`),record=await readJson(path.join(base,'review.json'));
    if(record.schema!==1||record.target?.id!==id||reviewHash(record)!==options.acceptHash)throw new Error('工程候选身份或确认哈希不符');
    const dir=await safePath(base,'project');
    if(!isDeepStrictEqual(await hashFiles(dir),record.files))throw new Error('工程候选已变化，请重新预览');
    await lockOperation(sha256(Buffer.from(path.resolve(root)+'/create-project')),()=>publish(root,record,dir,options));
    const cleanup=await fs.rm(base,{recursive:true,force:true}).then(()=>null,e=>'工程已创建；临时候选清理失败: '+e.message);
    return summary(record,{...record.report,created:true,check:'passed',...(cleanup?{notice:cleanup}:{})});
  }
  const {record,pack}=await request(root,id,options);
  if(!pack&&!options.confirm)return summary(record,{acceptHash:reviewHash(record),notice:'确认后由 Pakku 初始化；不创建或绑定 Runtime'});
  if(options.confirm&&pack)throw new Error('MRPACK 需要先生成候选，再使用 --candidate --accept-hash --confirm 接受');
  if(!pack&&options.acceptHash!==reviewHash(record))throw new Error('初始化参数或 workspace.json 已变化，请重新预览并确认哈希');
  if(pack?.issues.length)return summary(record,{dependencies:pack.dependencies,overrides:pack.overrides,skipped:pack.skipped,issues:pack.issues,blocked:true});
  const candidate=randomUUID(),relative=`.work/create-${candidate}/project`,dir=await safePath(root,relative),base=path.dirname(dir);
  let retained=false;
  try {
    await fs.mkdir(dir,{recursive:true});
    await initialize(root,dir,record.spec,options);
    const report=pack?await convert(root,dir,relative,pack,record.spec,options):{};
    if(report.issues?.length)return summary(record,{...report,blocked:true});
    await validateProject(root,{id,path:relative},record.spec,options);
    if(pack) {
      record.files=await hashFiles(dir);record.report=report;
      await jsonWrite(path.join(base,'review.json'),record);retained=true;
      return summary(record,{...report,candidate,acceptHash:reviewHash(record),notice:'隔离候选已验证，确认后注册为新 Target'});
    }
    await lockOperation(sha256(Buffer.from(path.resolve(root)+'/create-project')),()=>publish(root,record,dir,options));
    retained=true;
    const cleanup=await fs.rm(base,{recursive:true,force:true}).then(()=>null,e=>'工程已创建；临时候选清理失败: '+e.message);
    return summary(record,{created:true,check:'passed',...(cleanup?{notice:cleanup}:{})});
  } finally {if(!retained)await fs.rm(await safePath(root,`.work/create-${candidate}`),{recursive:true,force:true});}
}

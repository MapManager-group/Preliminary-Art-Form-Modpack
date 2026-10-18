import {isDeepStrictEqual} from 'node:util';
import {digest} from './prepare.mjs';

// Pakku 1.5.0 Project.pakkuLinks is a set of Pakku IDs, not part of file identity.
// Keep every other field (including future fields) exact; only additive links to new projects are allowed.
export function checkImportIntegrity(before,after) {
  const omit=(value,key)=>Object.fromEntries(Object.entries(value).filter(([k])=>k!==key));
  if(!isDeepStrictEqual(omit(before,'projects'),omit(after,'projects')))throw new Error('导入候选修改了目标版本或顶层上下文，拒绝接受');
  const index=lock=>{
    const projects=lock.projects??[];
    if(!Array.isArray(projects))throw new Error('导入候选 Project 列表无效');
    const result=new Map();
    for(const project of projects) {
      if(!project||typeof project.pakku_id!=='string'||!project.pakku_id.trim()||result.has(project.pakku_id))throw new Error('导入候选存在缺失或重复的 pakku_id');
      result.set(project.pakku_id,project);
    }
    return result;
  };
  const old=index(before),next=index(after),added=[...next.values()].filter(p=>!old.has(p.pakku_id));
  const addedIds=new Set(added.map(p=>p.pakku_id));
  for(const project of added)if([...next.values()].some(other=>other!==project&&Object.entries(project.id??{}).some(([platform,id])=>id&&other.id?.[platform]===id)))throw new Error('新增依赖与现有或本批 Project 重复，可能存在版本偏离，拒绝接受');
  const links=project=>{
    const values=Object.hasOwn(project,'pakku_links')?project.pakku_links:[];
    if(!Array.isArray(values)||values.some(v=>typeof v!=='string'||!v.trim())||new Set(values).size!==values.length)throw new Error('导入候选 pakku_links 必须是无重复的 Project ID 列表');
    return new Set(values);
  };
  for(const [id,project] of old) {
    const current=next.get(id);
    if(!current||!isDeepStrictEqual(omit(project,'pakku_links'),omit(current,'pakku_links')))throw new Error('导入候选删除或修改了现有依赖核心内容，拒绝接受');
    const previousLinks=links(project),currentLinks=links(current);
    if([...previousLinks].some(link=>!currentLinks.has(link)))throw new Error('导入候选删除了已有 pakku_links，拒绝接受');
    if([...currentLinks].some(link=>!previousLinks.has(link)&&!addedIds.has(link)))throw new Error('新增 pakku_links 未指向本次新增 Project，拒绝接受');
  }
  for(const project of added)if([...links(project)].some(link=>!next.has(link)))throw new Error('新增 Project 的 pakku_links 指向不存在的 Project，拒绝接受');
  return added;
}

// Pakku v1.5.0 ConfigFile/ProjectConfig defaults; sync --additions only reserializes
// configuration. Allow omission of these exact defaults, never arbitrary edits or new keys.
export function checkImportConfig(before,after) {
  const expected=structuredClone(before),changes=[];
  const omitDefaults=(old,next,defaults,prefix='')=>{
    for(const [key,value] of Object.entries(defaults))if(Object.hasOwn(old,key)&&!Object.hasOwn(next,key)&&isDeepStrictEqual(old[key],value)) {
      delete old[key];changes.push(prefix+key);
    }
  };
  if(!after||typeof after!=='object'||Array.isArray(after))throw new Error('Pakku 项目配置无效');
  omitDefaults(expected,after,{description:'',author:'',overrides:[],client_overrides:[],server_overrides:[],paths:{},projects:{},export_server_side_projects_to_client:false});
  for(const [key,value] of Object.entries(expected.projects??{})) {
    const next=after.projects?.[key];
    if(value&&next&&typeof value==='object'&&typeof next==='object')omitDefaults(value,next,{type:null,side:null,update_strategy:null,redistributable:null,subpath:null,aliases:null,export:null},`projects.${key}.`);
  }
  if(!isDeepStrictEqual(expected,after))throw new Error('Pakku 修改了项目配置（非已验证的默认值省略），拒绝导入');
  return changes;
}

// Legacy lock-only candidates retain their hash. Config changes bind both exact files.
export const candidateHash=(lock,config)=>config===undefined?digest(lock):digest(JSON.stringify({'pakku-lock.json':digest(lock),'pakku.json':digest(config)}));

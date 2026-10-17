import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {zipSync,strToU8} from 'fflate';
import {setup,stopped,save,snapshot} from './sync-fixture.mjs';
import {sourceSnapshot,digest} from '../tools/lib/prepare.mjs';
import {deploy,recover} from '../tools/lib/deploy.mjs';
import {apply,verifyBundle} from '../tools/lib/apply.mjs';
import {inspectZip,inspectArchive} from '../tools/lib/archive.mjs';
import {downloadArtifact,githubClient,releaseTag} from '../tools/lib/github.mjs';
import {affectedTargets,validateTag,ciPlan} from '../tools/ci.mjs';
import {publishDraft} from '../tools/release.mjs';
import {atomicJson,localPath} from '../tools/lib/runtime-fs.mjs';
import {isTargetId} from '../tools/lib/workspace.mjs';
import {validateExportOutput} from '../tools/lib/pakku.mjs';

async function bundleFor(f,edit=()=>{}) {
  const info=await sourceSnapshot(f.root,f.target),entries={};
  const index={formatVersion:1,game:'minecraft',versionId:info.config.version,name:info.config.name,files:[],dependencies:{minecraft:'1.21.1','fabric-loader':'0.16.14'}};
  for(const m of info.mapping)entries[m.archivePath]=await fs.readFile(path.join(info.dir,m.source));
  edit(entries,index);
  entries['modrinth.index.json']=strToU8(JSON.stringify(index));
  const bytes=zipSync(entries),name='example.mrpack';
  const report={schema:1,targetId:f.target.id,version:index.versionId,git:'a'.repeat(40),dirty:false,sourceFingerprint:info.fingerprint,lockHash:info.hashes['pakku-lock.json'],configHash:info.hashes['pakku.json'],toolchain:JSON.parse(await fs.readFile(path.join(f.root,'toolchain.json'))),dependencies:index.dependencies,artifacts:[{kind:'modrinth',name,sha256:digest(bytes),size:bytes.length}],missing:[],uncollected:[]};
  const reportBytes=Buffer.from(JSON.stringify(report)),sumsBytes=Buffer.from(`${digest(bytes)}  ${name}\n${digest(reportBytes)}  build-report.json\n`);
  const dir=path.join(f.root,'.work/bundle');await save(path.join(dir,name),bytes);await save(path.join(dir,'build-report.json'),reportBytes);await save(path.join(dir,'SHA256SUMS'),sumsBytes);
  return {name,bytes,reportBytes,sumsBytes,file:path.join(dir,name),report};
}
test('Apply 默认只读；明确哈希/确认后与本地同源 Deploy 内容一致，私人文件保留',async t=>{
  const f=await setup(t),bundle=await bundleFor(f);await save(path.join(f.gameDir,'options.txt'),'private');
  const before=await snapshot(f.base);await apply(f.root,f.runtime,f.target,{file:bundle.file,...stopped});assert.deepEqual(await snapshot(f.base),before);
  await assert.rejects(apply(f.root,f.runtime,f.target,{file:bundle.file,confirm:true,...stopped}),/sha256/);
  await apply(f.root,f.runtime,f.target,{file:bundle.file,sha256:digest(bundle.bytes),confirm:true,...stopped});
  const after=await snapshot(f.gameDir);assert.equal(after['options.txt'],digest(Buffer.from('private')));
  const baseline=JSON.parse(await fs.readFile(await localPath(f.root,`runtimes/${f.runtime.key}/baseline.json`)));assert.equal(baseline.source.kind,'file');
  await f.stage();await deploy(f.root,f.runtime,f.target,stopped);assert.deepEqual(await snapshot(f.gameDir),after);
});
test('Apply 拒绝错误 Target/版本/摘要/哈希，验证失败无实例写入',async t=>{
  const f=await setup(t),bundle=await bundleFor(f),before=await snapshot(f.gameDir);
  assert.throws(()=>verifyBundle(bundle,'another'),/身份/);
  assert.throws(()=>verifyBundle({...bundle,bytes:Buffer.from('bad')},f.target.id),/SHA256/);
  await assert.rejects(apply(f.root,f.runtime,f.target,{file:bundle.file,sha256:'0'.repeat(64),...stopped}),/SHA256/);
  const mismatch=await bundleFor(f,(_e,i)=>i.dependencies.minecraft='1.20.1');
  await assert.rejects(apply(f.root,f.runtime,f.target,{file:mismatch.file,...stopped}),/版本不匹配/);
  assert.deepEqual(await snapshot(f.gameDir),before);
});
test('Apply 未停止、源配置冲突、下载哈希错误不会覆盖实例',async t=>{
  const f=await setup(t),bundle=await bundleFor(f);
  await assert.rejects(apply(f.root,f.runtime,f.target,{file:bundle.file,sha256:digest(bundle.bytes),confirm:true}),/stopped/);
  await save(path.join(f.gameDir,'config/db-example.json'),'local conflict');
  await assert.rejects(apply(f.root,f.runtime,f.target,{file:bundle.file,sha256:digest(bundle.bytes),confirm:true,...stopped}),/冲突/);
  await fs.unlink(path.join(f.gameDir,'config/db-example.json'));
  const dep=await bundleFor(f,(_e,i)=>i.files.push({path:'mods/a.jar',hashes:{sha512:'1'.repeat(128),sha1:'1'.repeat(40)},downloads:['https://example.invalid/a.jar'],fileSize:1}));
  const before=await snapshot(f.gameDir);await assert.rejects(apply(f.root,f.runtime,f.target,{file:dep.file,sha256:digest(dep.bytes),confirm:true,...stopped,download:async()=>new Response('wrong')}),/下载失败/);assert.deepEqual(await snapshot(f.gameDir),before);
});
test('Apply 中断复用 recover，错误来源不会提前写成功基线',async t=>{
  const f=await setup(t),bundle=await bundleFor(f),before=await snapshot(f.gameDir);
  await assert.rejects(apply(f.root,f.runtime,f.target,{file:bundle.file,sha256:digest(bundle.bytes),confirm:true,...stopped,beforeWrite:(_c,i)=>{if(i===1)throw new Error('injected');}}),/recover/);
  await recover(f.root,f.runtime,stopped);assert.deepEqual(await snapshot(f.gameDir),before);
});
test('ZIP 拒绝重复大小写、文件目录冲突、符号链接、CRC 损坏与解压炸弹',()=>{
  for(const entries of [{'A.txt':strToU8('a'),'a.txt':strToU8('b')},{a:strToU8('x'),'a/b':strToU8('y')}])assert.throws(()=>inspectZip(zipSync(entries)),/冲突/);
  const zip=Buffer.from(zipSync({'a.txt':strToU8('x')},{level:0})),central=zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  const link=Buffer.from(zip);link.writeUInt32LE((0xa1ff*65536)>>>0,central+38);assert.throws(()=>inspectZip(link),/链接/);
  const crc=Buffer.from(zip);crc[35]^=1;assert.throws(()=>inspectZip(crc),/CRC/);
  const huge=Buffer.from(zip);huge.writeUInt32LE(0x7fffffff,central+24);assert.throws(()=>inspectZip(huge),/超限/);
});
test('MRPACK 所有侧别均检查私人路径/未知内容/重复索引/HTTP 下载',async t=>{
  const f=await setup(t);
  const bad=await bundleFor(f,e=>e['server-overrides/launcher_accounts.json']=strToU8('private'));assert.throws(()=>inspectArchive(bad.bytes,'modrinth'),/禁止/);
  const unknown=await bundleFor(f,e=>e['unexplained.txt']=strToU8('x'));assert.throws(()=>inspectArchive(unknown.bytes,'modrinth'),/未知/);
  const invalid=await bundleFor(f,(_e,i)=>i.files.push({path:'mods/a.jar',hashes:{sha512:'a'.repeat(128),sha1:'b'.repeat(40)},fileSize:0,downloads:['http://example.invalid/a.jar']}));
  await assert.rejects(apply(f.root,f.runtime,f.target,{file:invalid.file,...stopped}),/HTTPS/);
  const duplicate=await bundleFor(f,(_e,i)=>{const dep={path:'mods/a.jar',hashes:{sha512:'a'.repeat(128),sha1:'b'.repeat(40)},fileSize:0,downloads:['https://example.invalid/a.jar']};i.files=[dep,{...dep,env:{client:'unsupported'}}];});
  await assert.rejects(apply(f.root,f.runtime,f.target,{file:duplicate.file,...stopped}),/重复/);
});
function remote(bundle,changes={}) {
  const archive=zipSync({[bundle.name]:bundle.bytes,'build-report.json':bundle.reportBytes,SHA256SUMS:bundle.sumsBytes});
  const run={id:123,repository:{full_name:'owner/repo'},path:'.github/workflows/ci.yml',status:'completed',conclusion:'success',head_sha:'a'.repeat(40),event:'pull_request',...changes};
  const fetch=async url=>{
    const u=String(url);
    if(u.endsWith('/actions/runs/123'))return Response.json(run);
    if(u.includes('/artifacts?'))return Response.json({total_count:1,artifacts:[{id:2,name:'preview-example',expired:false,digest:'sha256:'+digest(archive),workflow_run:{head_sha:run.head_sha}}]});
    if(u.endsWith('/actions/artifacts/2/zip'))return new Response(archive);
    throw new Error('unexpected request');
  };
  return fetch;
}
test('Run 下载限定成功 ci.yml、Artifact digest 与报告提交；PR 需要明确确认',async t=>{
  const f=await setup(t),bundle=await bundleFor(f),fetch=remote(bundle),before=await snapshot(f.base);
  await apply(f.root,f.runtime,f.target,{run:'123',repo:'owner/repo',fetch,...stopped});assert.deepEqual(await snapshot(f.base),before);
  await apply(f.root,f.runtime,f.target,{run:'123',repo:'owner/repo',fetch,...stopped,confirm:true,sha256:digest(bundle.bytes)});
  const baseline=JSON.parse(await fs.readFile(await localPath(f.root,`runtimes/${f.runtime.key}/baseline.json`)));assert.equal(baseline.source.kind,'ci');assert.equal(baseline.source.run,'123');
  await assert.rejects(downloadArtifact('example',{run:'123',repo:'owner/repo',fetch:remote(bundle,{conclusion:'failure'})}),/成功/);
  await assert.rejects(downloadArtifact('example',{run:'123',repo:'owner/repo',fetch:remote(bundle,{path:'.github/workflows/other.yml'})}),/成功/);
  await assert.rejects(apply(f.root,f.runtime,f.target,{run:'123',repo:'owner/repo',fetch:remote(bundle,{head_sha:'b'.repeat(40)}),...stopped}),/提交不符/);
});
test('认证失败明确提示离线入口，外部跳转不携带 Token',async()=>{
  await assert.rejects(githubClient({fetch:async()=>new Response('',{status:401})}).api('/test'),/GH_TOKEN.*--file/);
  const calls=[];const client=githubClient({token:'test-only',fetch:async(url,options)=>{calls.push([String(url),options]);return calls.length===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/a'}}):new Response('ok');}});
  assert.equal((await client.download('/test')).toString(),'ok');assert.ok(!calls[1][1].headers);
  await assert.rejects(githubClient({fetch:async()=>new Response(null,{status:302,headers:{location:'https://evil.invalid/a'}})}).download('/test'),/不可信/);
});
test('Release 下载核对 Tag 提交和每个资产 digest，拒绝过期/错误 Artifact',async t=>{
  const f=await setup(t),bundle=await bundleFor(f),files={[bundle.name]:bundle.bytes,'build-report.json':bundle.reportBytes,SHA256SUMS:bundle.sumsBytes};
  const assets=Object.entries(files).map(([name,bytes],i)=>({id:i+1,name,digest:'sha256:'+digest(bytes)}));
  const fetch=async url=>{
    const u=String(url);
    if(u.includes('/releases/tags/'))return Response.json({tag_name:'release/example/v0.1.0',draft:false,assets});
    if(u.includes('/git/ref/tags/'))return Response.json({object:{type:'commit',sha:'a'.repeat(40)}});
    const match=u.match(/\/releases\/assets\/(\d+)$/);if(match)return new Response(files[assets[Number(match[1])-1].name]);
    throw new Error('unexpected request');
  };
  const release=await downloadArtifact('example',{repo:'owner/repo',release:'release/example/v0.1.0',fetch});assert.equal(release.provenance.kind,'release');assert.equal(release.provenance.git,'a'.repeat(40));
  assets[0].digest='sha256:'+'0'.repeat(64);await assert.rejects(downloadArtifact('example',{repo:'owner/repo',release:'release/example/v0.1.0',fetch}),/digest/);
  const original=remote(bundle);
  for(const mutation of [{expired:true},{digest:'sha256:'+'0'.repeat(64)}])await assert.rejects(downloadArtifact('example',{run:'123',repo:'owner/repo',fetch:async(url,options)=>{const response=await original(url,options);if(String(url).includes('/artifacts?')){const list=await response.json();Object.assign(list.artifacts[0],mutation);return Response.json(list);}return response;}}));
});
test('Pakku 零退出码不掩盖导出错误或隐式迁移',()=>{
  const success={code:0,stdout:"[modrinth profile] exported to './build/example.mrpack'",stderr:''};
  assert.equal(validateExportOutput(success),success);
  for(const stdout of ['',success.stdout+'\n[serverpack profile] missing project',success.stdout+'\n[Migration] Upgraded lockfile'])assert.throws(()=>validateExportOutput({...success,stdout}),/不执行完整构建/);
});
test('CI 受影响目标选择：纯文档不打包，单目标只构建自身，共享改动全部构建',()=>{
  const w={targets:[{id:'a',path:'packs/a'},{id:'b',path:'packs/b'}]};
  assert.deepEqual(affectedTargets(w,['README.md','docs/RELEASE.md']),[]);
  assert.deepEqual(affectedTargets(w,['packs/a/config/x.json']),['a']);
  for(const file of ['tools/mp.mjs','workspace.json','toolchain.json','.github/workflows/ci.yml','pnpm-lock.yaml'])assert.deepEqual(affectedTargets(w,[file]),['a','b']);
  assert.deepEqual(affectedTargets(w,[],true),['a','b']);
});
test('Tag 严格匹配 Target/版本，拒绝路径注入；手动 CI 选择所有目标',async t=>{
  const f=await setup(t);assert.equal((await validateTag(f.root,'release/example/v0.1.0')).target.id,'example');
  for(const tag of ['release/example/v9.0.0','release/unknown/v0.1.0','release/example/v0.1.0/../../bad'])await assert.rejects(validateTag(f.root,tag));
  const plan=await ciPlan(f.root,{after:'a'.repeat(40)},'workflow_dispatch');assert.deepEqual(plan.targets,['example']);
});
test('Draft Release 模拟创建上传只允许草稿，已存在的正式/草稿均不覆盖',async t=>{
  const f=await setup(t),bundle=await bundleFor(f),calls=[];
  const mock=async(url,options={})=>{
    const u=String(url);calls.push([u,options]);
    if(u.includes('/git/ref/tags/'))return Response.json({object:{type:'commit',sha:'a'.repeat(40)}});
    if(u.includes('/releases/tags/'))return new Response('',{status:404});
    if(u.endsWith('/releases')){assert.equal(JSON.parse(options.body).draft,true);return Response.json({id:9,draft:true});}
    if(u.startsWith('https://uploads.github.com/'))return Response.json({digest:'sha256:'+digest(options.body)});
    throw new Error('unexpected request');
  };
  const options={repo:'owner/repo',tag:'release/example/v0.1.0',directory:'.work/bundle',publish:true,fetch:mock,token:'test-only'};
  assert.equal((await publishDraft(f.root,options)).draft,true);assert.equal(calls.filter(c=>c[0].startsWith('https://uploads')).length,3);
  for(const draft of [true,false])await assert.rejects(publishDraft(f.root,{...options,fetch:async(url,init)=>String(url).includes('/releases/tags/')?Response.json({id:8,draft}):mock(url,init)}),/拒绝覆盖/);
});


test('Release Tag 与 Workspace 共用 Target ID 规则',()=>{
  for(const id of ['fabric-1.21.1','neoforge-1.21.1','example','a-b.2']) {
    assert.equal(isTargetId(id),true);
    assert.equal(releaseTag(`release/${id}/v0.1.0`,id),'0.1.0');
    assert.equal(releaseTag(`release/${id}/v0.1.0-rc.1`,id),'0.1.0-rc.1');
  }
  for(const id of ['bad_id','UPPER','../a','a/b','','a\n']) {
    assert.equal(isTargetId(id),false);
    assert.throws(()=>releaseTag(`release/${id}/v0.1.0`,id));
  }
  for(const tag of ['release/fabric-1.21.1/v0.1.0/extra','release/fabric-1.21.1/v0.1.0\n','release/fabric-1.21.1/v0.1.0-..'])assert.throws(()=>releaseTag(tag,'fabric-1.21.1'));
  assert.throws(()=>releaseTag('release/fabric-1.21.1/v0.1.0','neoforge-1.21.1'));
});

for(const id of ['fabric-1.21.1','neoforge-1.21.1'])test(`${id} 支持 Tag 校验、Draft 上传和远端 Apply`,async t=>{
  const f=await setup(t);f.target.id=id;f.runtime.targetId=id;
  await atomicJson(path.join(f.root,'workspace.json'),{targets:[f.target]});
  await atomicJson(await localPath(f.root,'runtimes.json'),{schema:1,bindings:[f.runtime]});
  const tag=`release/${id}/v0.1.0`,bundle=await bundleFor(f);
  assert.equal((await validateTag(f.root,tag)).target.id,id);
  await assert.rejects(validateTag(f.root,`release/${id}/v9.0.0`),/版本不符/);
  const files={[bundle.name]:bundle.bytes,'build-report.json':bundle.reportBytes,SHA256SUMS:bundle.sumsBytes};
  const assets=Object.entries(files).map(([name,bytes],i)=>({id:i+1,name,digest:'sha256:'+digest(bytes)}));
  let created=false,uploads=0;
  const fetch=async(url,options={})=>{
    const u=String(url);
    if(u.includes('/git/ref/tags/'))return Response.json({object:{type:'commit',sha:'a'.repeat(40)}});
    if(u.includes('/releases/tags/'))return created?Response.json({tag_name:tag,draft:true,assets}):new Response('',{status:404});
    if(u.endsWith('/releases')){const body=JSON.parse(options.body);assert.equal(body.tag_name,tag);assert.equal(body.draft,true);created=true;return Response.json({id:9,draft:true});}
    if(u.startsWith('https://uploads.github.com/')){uploads++;return Response.json({digest:'sha256:'+digest(options.body)});}
    const match=u.match(/\/releases\/assets\/(\d+)$/);if(match)return new Response(files[assets[Number(match[1])-1].name]);
    throw new Error('unexpected request');
  };
  assert.equal((await publishDraft(f.root,{repo:'owner/repo',tag,directory:'.work/bundle',publish:true,fetch,token:'test-only'})).draft,true);
  assert.equal(uploads,3);
  const before=await snapshot(f.base),options={repo:'owner/repo',release:tag,fetch,...stopped};
  await apply(f.root,f.runtime,f.target,options);assert.deepEqual(await snapshot(f.base),before);
  await apply(f.root,f.runtime,f.target,{...options,confirm:true,sha256:digest(bundle.bytes)});
  const baseline=JSON.parse(await fs.readFile(await localPath(f.root,`runtimes/${f.runtime.key}/baseline.json`)));
  assert.equal(baseline.targetId,id);assert.equal(baseline.source.tag,tag);
});

test('Apply 支持默认 options、根目录配置和脚本，但不能触碰实际启动器版本 JSON',async t=>{
  const f=await setup(t);
  const bundle=await bundleFor(f,e=>{
    e['client-overrides/options.txt']=strToU8('fov:85\n');
    e['client-overrides/custom.json']=strToU8('{}');
    e['overrides/scripts/helper.sh']=strToU8('echo authored\n');
  });
  await apply(f.root,f.runtime,f.target,{file:bundle.file,sha256:digest(bundle.bytes),confirm:true,...stopped});
  assert.equal(await fs.readFile(path.join(f.gameDir,'options.txt'),'utf8'),'fov:85\n');
  assert.equal(await fs.readFile(path.join(f.gameDir,'scripts/helper.sh'),'utf8'),'echo authored\n');
  const before=await snapshot(f.gameDir);
  const bad=await bundleFor(f,e=>e['overrides/Example.json']=strToU8('{}'));
  await assert.rejects(apply(f.root,f.runtime,f.target,{file:bad.file,...stopped}),/实际启动器版本文件/);
  assert.deepEqual(await snapshot(f.gameDir),before);
});

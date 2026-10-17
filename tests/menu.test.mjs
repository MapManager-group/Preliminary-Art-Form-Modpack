import {probePowerShell,menuTestOptions} from '../tools/lib/powershell.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const probe=probePowerShell();
const pwsh=probe.status==='ready'?probe.path:null;
const psQuote=value=>`'${value.replaceAll("'","''")}'`;
const mock=String.raw`
import fs from 'node:fs';
const args=process.argv.slice(2), command=args[0]==='--silent'?args[4]:null;
fs.appendFileSync(process.env.MENU_LOG,JSON.stringify(args)+'\n');
const spec=JSON.parse(fs.readFileSync(process.env.MENU_SPEC));
const out=x=>console.log(JSON.stringify(x,null,2));
const id=args[5];
if(command==='build' && spec.progress) {
  console.error('@mp:'+JSON.stringify({schema:1,type:'progress',stage:'build.verify',message:'fixture live progress'}));
  const until=Date.now()+8000;
  while(!fs.existsSync(process.env.MENU_ACK)) {
    if(Date.now()>until){console.error('progress was buffered');process.exit(38);}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  console.error('@mp:'+JSON.stringify({schema:1,type:'diagnostic',text:'PAKKU-RAW-DIAGNOSTIC'}));
  if(spec.progressFailure){console.error('fixture progress failure');process.exit(37);}
}
if(command===spec.fail || (spec.failFile && args.includes('--file') && args.includes(spec.failFile))){console.error('fixture failure');process.exit(37);}
switch(command){
case 'status':out({selected:spec.selected,gitDirty:true,runtimes:[],targets:spec.targets.map(id=>({id})),bindings:spec.bindings});break;
case 'inspect-pack':out({action:'inspect-pack',name:'Original',mc:'1.21.1',loader:'fabric',loaderVersion:'0.16.14',dependencies:1,overrides:[],issues:spec.badPack?[{path:'mods/unknown.jar',reason:'无法转换'}]:[]});break;
case 'create-target':
  out({action:'create-project',target:id,directory:'packs/'+id,name:'New',mc:'1.21.1',loader:'fabric',loaderVersion:'0.16.14',platform:'modrinth',dependencies:1,converted:[{path:'mods/demo.jar'}],issues:[],created:args.includes('--confirm'),acceptHash:'e'.repeat(64),...(args.includes('--file')?{candidate:'pack-candidate'}:{})});break;
case 'targets':out(spec.targets.map(id=>({id,path:'packs/'+id,artifacts:['modrinth']})));break;
case 'runtimes':out({bindings:spec.bindings});break;
case 'use':spec.selected=id;fs.writeFileSync(process.env.MENU_SPEC,JSON.stringify(spec));out({selected:id});break;
case 'dev':case 'deploy':case 'restore-deps':out({actions:[{type:'delete',path:'config/old.json'}],conflicts:[]});break;
case 'apply':out({action:'apply',target:spec.selected,version:'0.1.0',git:'a'.repeat(40),provenance:{kind:'file',packageHash:'b'.repeat(64)}});out({actions:[{type:'update',path:'config/a.json'}],conflicts:[]});break;
case 'collect':case 'changes':out({managed:spec.managed??[{path:'config/a.json',state:spec.conflict?'conflict':'runtime-only',source:'config/a.json',runtime:spec.deleted?null:'hash',diff:{text:'--- source\n+++ runtime\n-old\n+new'}}],candidates:spec.candidates??[{path:'config/new.json',state:'candidate',diff:{text:'+new config'}}],dependencies:[],conflicts:[]});break;
case 'import-deps':
  if(args.includes('--candidate'))out({collected:'pakku-lock.json'});
  else if(args.includes('--selection')) {
    const selected=JSON.parse(fs.readFileSync(args[args.indexOf('--selection')+1]));
    fs.appendFileSync(process.env.MENU_LOG,JSON.stringify(['batch-selection',selected])+'\n');
    const failed=selected.filter(f=>f.path===spec.failFile).map(f=>({path:f.path,reason:'fixture identification failure'}));
    out({action:'import-batch',recognized:selected.filter(f=>f.path!==spec.failFile).map(f=>({path:f.path,project:'recognized-project'})),failed,skipped:[],blocked:!!failed.length,pending:failed.length?0:selected.length,...(failed.length?{}:{id:'import-id',hash:'c'.repeat(64),projectPath:'.work/import',diff:{text:'+recognized mod'}})});
    if(failed.length)process.exitCode=1;
  } else if(args.includes('--file'))out({id:'import-id',hash:'c'.repeat(64),projectPath:'.work/import',diff:{text:'+recognized mod'}});
  else out({action:'import-deps',candidates:spec.importItems??[{path:'mods/new.jar',hash:'a'.repeat(64)}],skipped:[]});break;
case 'deps-review':out({id:'candidate-id',hash:'c'.repeat(64),operation:'add',project:'sodium',projectPath:'.work/candidate',diff:{text:'-old\n+new'}});break;
case 'bind':out({action:'bind',runtime:{id,launcher:'hmcl',targetId:spec.selected,mc:'1.21.1',loaders:{fabric:'0.16.14'},gameDir:args[args.indexOf('--game-dir')+1],versionDir:'version',layout:'isolated'},existing:[]});break;
case 'build':out({target:args[args.indexOf('--target')+1],output:'dist/output',artifacts:[{kind:'modrinth',name:'example.mrpack'}]});break;
default:out({received:args});
}
`;
async function fixture(t,override={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'DB 菜单 空格-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.copyFile(path.join(repo,'ci.ps1'),path.join(root,'ci.ps1'));
  const bin=path.join(root,'bin');await fs.mkdir(bin);
  await fs.writeFile(path.join(root,'mock.mjs'),mock);
  await fs.writeFile(path.join(bin,'pnpm.ps1'),`& ${psQuote(process.execPath)} ${psQuote(path.join(root,'mock.mjs'))} @args\nexit $LASTEXITCODE\n`);
  await fs.writeFile(path.join(bin,'node.ps1'),'# environment detection fixture\n');
  if(process.platform!=='win32')await fs.symlink(process.execPath,path.join(bin,'node'));
  const spec=path.join(root,'spec.json'),log=path.join(root,'calls.jsonl');
  await fs.writeFile(spec,JSON.stringify({selected:'a',targets:['a','b'],bindings:[{id:'dev-a',targetId:'a',launcher:'hmcl'},{id:'dev-b',targetId:'b'}],...override}));
  const execute=(args=[],input='',extraEnv={},onOutput=()=>{})=>new Promise((resolve,reject)=>{
    const child=spawn(pwsh,['-NoProfile','-NonInteractive','-File',path.join(root,'ci.ps1'),...args],{
      cwd:os.tmpdir(),env:{...process.env,PATH:bin,MP_ICONS:'',MENU_LOG:log,MENU_SPEC:spec,...extraEnv},windowsHide:true,
    });
    let stdout='',stderr='';child.stdout.on('data',d=>{stdout+=d;onOutput(stdout);});child.stderr.on('data',d=>stderr+=d);
    const timeout=setTimeout(()=>{child.kill();reject(new Error(`menu timed out: ${stdout.slice(-1500)} ${stderr}`));},20000);
    child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);resolve({code,stdout,stderr});});child.stdin.end(input);
  });
  const calls=async()=>{try{return (await fs.readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}};
  const commands=async()=> (await calls()).filter(a=>a[0]==='--silent').map(a=>a.slice(4));
  return {root,bin,execute,calls,commands};
}
const options=menuTestOptions(probe);

test('纯菜单导航不重复查询状态，手动刷新和失败操作后重新读取',options,async t=>{
  const f=await fixture(t,{fail:'doctor'});
  const result=await f.execute([], '1\n0\n2\n0\nd\n\nwrong\nr\n7\n3\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  const calls=await f.commands();
  // Initial load, explicit refresh, and refresh after the failed operation.
  assert.equal(calls.filter(a=>a[0]==='status').length,3,JSON.stringify(calls));
  assert.ok(calls.filter(a=>a[0]==='status').every(a=>a.includes('--light')));
  assert.ok(!calls.some(a=>['targets','runtimes'].includes(a[0])));
  assert.equal(calls.filter(a=>a[0]==='doctor').length,1);
  assert.match(result.stdout,/fixture failure/);
});
test('菜单无绑定可启动退出，无效选择返回菜单，帮助不依赖 pnpm',options,async t=>{
  const f=await fixture(t,{bindings:[]});
  const result=await f.execute([], 'wrong\n0\n');assert.equal(result.code,0,result.stdout+result.stderr);
  assert.match(result.stdout,/未绑定/);assert.match(result.stdout,/有未提交改动/);assert.match(result.stdout,/请输入菜单编号/);
  await fs.unlink(path.join(f.bin,'pnpm.ps1'));
  assert.equal((await f.execute(['help'])).code,0);
  const missing=await f.execute(['status']);assert.equal(missing.code,1);assert.match(missing.stdout,/pnpm/);
  await fs.unlink(path.join(f.bin,'node.ps1'));
  if(process.platform!=='win32')await fs.unlink(path.join(f.bin,'node'));
  assert.match((await f.execute(['status'])).stdout,/Node.js/);
});
test('缺少项目依赖给出安装提示，不自动安装',options,async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'package.json'),'{}');
  const result=await f.execute(['status']);assert.equal(result.code,1);assert.match(result.stdout,/pnpm install --frozen-lockfile/);
  assert.equal((await f.calls()).length,0);
});
test('直接模式安全转发中文、空格、引号及 shell 字符；退出码不丢失',options,async t=>{
  const f=await fixture(t,{fail:'check'});
  const special='中文 空格 "quoted" $(touch nope); & | %value%';
  let result=await f.execute(['mp','--','pakku','--target','a','--','cfg','--name',special]);
  assert.equal(result.code,0,result.stdout+result.stderr);
  assert.deepEqual((await f.commands()).at(-1),['pakku','--target','a','--','cfg','--name',special]);
  result=await f.execute(['check','-All']);assert.equal(result.code,37,result.stdout+result.stderr);
  assert.deepEqual((await f.commands()).at(-1),['check','--all']);
  assert.doesNotMatch(result.stdout,/\[y\/N\]|选择/);
});
test('直接模式不会偷偷补 Deploy Collect Apply 的确认参数',options,async t=>{
  const f=await fixture(t);
  for(const command of ['deploy','collect','apply']) {
    const result=await f.execute([command,'-Runtime','dev-a','-Target','a']);
    assert.equal(result.code,0,result.stdout+result.stderr);
    assert.deepEqual((await f.commands()).at(-1),[command,'dev-a','--target','a']);
    assert.doesNotMatch(result.stdout,/\[y\/N\]/);
  }
  await f.execute(['collect','-Runtime','dev-a','-File','config/中文 空格.json','-Confirm','-Stopped']);
  assert.deepEqual((await f.commands()).at(-1),['collect','dev-a','--file','config/中文 空格.json','--confirm','--stopped']);
});
test('Target 复用 use，切换目标后不会部署到旧 Runtime',options,async t=>{
  const f=await fixture(t);
  const result=await f.execute([], '2\n1\n2\n\n3\nn\nn\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  const calls=await f.commands();assert.ok(calls.some(a=>a[0]==='use'&&a[1]==='b'),result.stdout+'\n'+JSON.stringify(calls));
  const preview=calls.find(a=>a[0]==='dev');assert.deepEqual(preview,['dev','dev-b','--target','b','--dry-run']);
  assert.ok(!calls.some(a=>a.includes('--stopped')));
});
test('多 Runtime 需明确选择并在会话内保留，真实部署需独立停止确认',options,async t=>{
  const f=await fixture(t,{targets:['a'],bindings:[{id:'one',targetId:'a'},{id:'two',targetId:'a'}]});
  const result=await f.execute([], '2\n2\n2\n\n3\nn\ny\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  const calls=await f.commands();assert.ok(calls.some(a=>a[0]==='dev'&&a[1]==='two'&&a.includes('--stopped')));
  assert.ok(!calls.some(a=>a[0]==='dev'&&a[1]==='one'));
});
test('Collect 摘要隐藏差异，删除单独确认；冲突不发写入命令',options,async t=>{
  const f=await fixture(t,{deleted:true});
  const result=await f.execute([], '4\n3\nspace\nenter\ny\ny\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);assert.doesNotMatch(result.stdout,/-old\n\+new/);
  assert.ok((await f.commands()).some(a=>a[0]==='collect'&&a.includes('--delete')&&a.includes('--confirm')&&a.includes('--stopped')));
  const conflict=await fixture(t,{conflict:true});
  const blocked=await conflict.execute([], '4\n3\nesc\n\n0\n0\n');
  assert.match(blocked.stdout,/冲突需要先人工合并/);
  assert.ok(!(await conflict.commands()).some(a=>a.includes('--confirm')));
});
test('Collect 新配置需选择来源，拒绝或取消不会回收所有文件',options,async t=>{
  const f=await fixture(t);
  const result=await f.execute([], '4\n3\ndown\nspace\nenter\n1\ny\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  assert.ok((await f.commands()).some(a=>a.includes('.pakku/client-overrides/config/new.json')&&a.includes('--confirm')));
  const cancelled=await fixture(t);await cancelled.execute([], '4\n3\ndown\nspace\nenter\n0\n\n0\n0\n');
  assert.ok(!(await cancelled.commands()).some(a=>a.includes('--confirm')));
});
test('Apply 必须先预览，拒绝则不写；确认时转发预览哈希和停止确认',options,async t=>{
  for(const answer of ['n','y']) {
    const f=await fixture(t);const result=await f.execute([], `6\n1\n中文 空格/包.mrpack\nn\n${answer}\n\n0\n0\n`);
    assert.equal(result.code,0,result.stdout+result.stderr);
    const calls=(await f.commands()).filter(a=>a[0]==='apply');assert.equal(calls.length,answer==='y'?2:1);
    assert.ok(!calls[0].includes('--confirm'));
    if(answer==='y')assert.deepEqual(calls[1].slice(-4),['--sha256','b'.repeat(64),'--confirm','--stopped']);
  }
});
test('绑定先预览再确认，解绑明确确认；未选择不写',options,async t=>{
  const f=await fixture(t,{bindings:[]});
  const result=await f.execute([], '2\n6\n2\nnew-dev\nD:\\游戏 测试\\Example\n\ny\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  const calls=(await f.commands()).filter(a=>a[0]==='bind');assert.equal(calls.length,2);
  assert.ok(calls[0].includes('--dry-run'));assert.ok(calls[1].includes('--confirm-game-dir'));
  assert.ok(calls[0].includes('D:\\游戏 测试\\Example'),JSON.stringify(calls));
  const cancelled=await fixture(t);await cancelled.execute([], '2\n8\n1\nn\n\n0\n0\n');
  assert.ok(!(await cancelled.commands()).some(a=>a[0]==='unbind'));
});
test('候选接受使用审查哈希；恢复和批量更新可取消',options,async t=>{
  const f=await fixture(t);const result=await f.execute([], '3\n6\nadd\nsodium\ny\ny\n\n7\n\nn\n\n4\nn\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  const calls=await f.commands();assert.ok(calls.some(a=>a[0]==='deps-accept'&&a.includes('c'.repeat(64))&&a.includes('--confirm')));
  assert.ok(!calls.some(a=>a[0]==='update'||a[0]==='restore-deps'&&a.includes('--confirm')));
});
test('构建所有目标顺序调用已有 build，失败可返回菜单，提交使用原脚本',options,async t=>{
  const f=await fixture(t,{selected:null,fail:'build'});const result=await f.execute([], '5\n2\n\n0\n8\n4\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);assert.match(result.stdout,/fixture failure/);
  const calls=await f.commands();assert.deepEqual(calls.filter(a=>a[0]==='build'),[['build','--target','a'],['build','--target','b']],result.stdout);
  assert.ok((await f.calls()).some(a=>a.join(' ')==='run lint:commits'));
  const source=await fs.readFile(path.join(repo,'ci.ps1'),'utf8');assert.match(source,/run commit/);assert.doesNotMatch(source,/Invoke-Expression|git add \./);
});


test('叶子成功、失败、无结果和取消均暂停；纯导航和直接模式不暂停',options,async t=>{
  for(const [input,override] of [['7\n3\n\n0\n0\n',{}],['7\n3\n\n0\n0\n',{fail:'doctor'}],['5\n3\n\n0\n0\n',{}],['3\n1\n0\n\n0\n0\n',{}],['9\n0\n\n0\n',{}]]) {
    const f=await fixture(t,override),result=await f.execute([],input);
    assert.equal(result.code,0,result.stdout+result.stderr);
    assert.equal((result.stdout.match(/按 Enter 继续/g)||[]).length,1,result.stdout);
    const pause=result.stdout.indexOf('按 Enter 继续');
    assert.ok(result.stdout.lastIndexOf('Preliminary Art Form v2')>pause);
    assert.match(result.stdout,/启动器  hmcl/);
  }
  const f=await fixture(t),nav=await f.execute([],'1\n0\n2\n0\n0\n');
  assert.equal(nav.code,0);assert.doesNotMatch(nav.stdout,/按 Enter 继续/);
  assert.doesNotMatch((await f.execute(['status'])).stdout,/按 Enter 继续/);
});

test('Runtime ID 在输入时校验，非法名称不调用 bind',options,async t=>{
  const f=await fixture(t,{bindings:[]});
  const result=await f.execute([],'2\n6\n2\nfabric-1.21.1-debug\nUPPER\nbad name\n0\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);assert.match(result.stdout,/不能含句点/);assert.match(result.stdout,/pcl2-debug、hmcl-dev/);
  assert.ok(!(await f.commands()).some(a=>a[0]==='bind'));
});

test('导入点选 JAR 并确认候选哈希，取消不写正式源',options,async t=>{
  for(const answer of ['y','n']) {
    const f=await fixture(t),result=await f.execute([],`3\n8\nspace\nenter\n${answer}\n\n0\n0\n`);
    assert.equal(result.code,0,result.stdout+result.stderr);
    const calls=(await f.commands()).filter(a=>a[0]==='import-deps');assert.equal(calls.length,answer==='y'?3:2);
    assert.ok(calls[1].includes('--selection'));assert.ok(!calls[1].includes('--confirm'));
    assert.deepEqual((await f.calls()).find(a=>a[0]==='batch-selection')[1],[{path:'mods/new.jar',hash:'a'.repeat(64)}]);
    await assert.rejects(fs.access(calls[1][calls[1].indexOf('--selection')+1]));
    if(answer==='y')assert.ok(calls[2].includes('c'.repeat(64))&&calls[2].includes('--confirm'));
    assert.doesNotMatch(result.stdout,/recognized mod|SHA256|c{64}/);assert.equal((result.stdout.match(/按 Enter 继续/g)||[]).length,1);
  }
});

test('菜单在 Enter 到达前保持结果页，不查询状态或绘制下一级菜单',options,async t=>{
  const f=await fixture(t);
  const child=spawn(pwsh,['-NoProfile','-NonInteractive','-File',path.join(f.root,'ci.ps1')],{env:{...process.env,PATH:f.bin,MENU_LOG:path.join(f.root,'calls.jsonl'),MENU_SPEC:path.join(f.root,'spec.json')},windowsHide:true});
  t.after(()=>child.kill());
  let output='',resumed=false;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('未等待或未退出: '+output.slice(-800))),10000);
    child.on('error',reject);
    child.stdout.on('data',chunk=>{
      output+=chunk;
      if(!resumed&&output.includes('按 Enter 继续')) {
        resumed=true;
        const atPause=output;
        setTimeout(()=>{
          try {assert.equal(output,atPause);child.stdin.end('\n0\n0\n');}catch(e){reject(e);}
        },150);
      }
    });
    child.on('close',code=>{clearTimeout(timeout);try{assert.equal(code,0,output);assert.equal(resumed,true);resolve();}catch(e){reject(e);}});
    child.stdin.write('7\n3\n');
  });
});

test('多选移动边界、切换、全选清空、空选和取消不会误写',options,async t=>{
  const entries=Array.from({length:15},(_,i)=>({path:`mods/${i}.jar`,hash:'a'.repeat(64)}));
  for(const [keys,expected] of [
    ['up\nspace\nspace\na\nn\n'+ 'down\n'.repeat(18)+'space\nenter\n',['mods/14.jar']],
    ['a\nn\nenter\n',[]],['a\nesc\n',[]],
  ]) {
    const f=await fixture(t,{importItems:entries});
    const result=await f.execute([],`3\n8\n${keys}${expected.length?'y\n':''}\n0\n0\n`);
    assert.equal(result.code,0,result.stdout+result.stderr);
    const selections=(await f.calls()).filter(a=>a[0]==='batch-selection');
    assert.deepEqual(selections.flatMap(a=>a[1].map(f=>f.path)),expected);
    assert.match(result.stdout,/已选择/);
  }
  const empty=await fixture(t,{managed:[],candidates:[]});
  const result=await empty.execute([],'4\n3\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout);assert.match(result.stdout,/没有可选文件/);
  assert.ok(!(await empty.commands()).some(a=>a.includes('--confirm')));
});

test('Collect 多选逐项确认；摘要隐藏 diff，d 保留整个操作详情',options,async t=>{
  const f=await fixture(t);
  const result=await f.execute([],'4\n3\na\nenter\ny\n1\ny\n\nd\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  const writes=(await f.commands()).filter(a=>a[0]==='collect'&&a.includes('--confirm'));
  assert.deepEqual(writes.map(a=>a[a.indexOf('--file')+1]),['config/a.json','config/new.json']);
  assert.ok(writes.every(a=>a.includes('--stopped')));
  assert.match(result.stdout,/回收完成 2 \/ 2/);
  const beforeDetail=result.stdout.slice(0,result.stdout.indexOf('按 Enter 继续'));
  assert.doesNotMatch(beforeDetail,/-old|\+new/);assert.match(result.stdout,/-old/);
});

test('Import 四个 JAR 批量识别后只确认一次，单一候选只接受一次',options,async t=>{
  const entries=Array.from({length:4},(_,i)=>({path:`mods/${i}.jar`,hash:'a'.repeat(64)}));
  const f=await fixture(t,{importItems:entries});
  const result=await f.execute([],'3\n8\na\nenter\ny\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  const calls=(await f.commands()).filter(a=>a[0]==='import-deps');assert.equal(calls.length,3);
  assert.ok(calls[1].includes('--selection')&&calls[2].includes('--candidate'));
  assert.deepEqual((await f.calls()).find(a=>a[0]==='batch-selection')[1],entries);
  assert.match(result.stdout,/一次性导入 4/);
  assert.equal((result.stdout.match(/\[y\/N/g)||[]).length,1);
  assert.equal((result.stdout.match(/按 Enter 继续/g)||[]).length,1);
  assert.doesNotMatch(result.stdout,/recognized mod|c{64}/);
});

test('Import 批量确认前 d 查看统一候选，取消后不写入',options,async t=>{
  const f=await fixture(t),result=await f.execute([],'3\n8\na\nenter\nd\nn\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout);assert.match(result.stdout,/recognized mod/);
  assert.equal((await f.commands()).filter(a=>a[0]==='import-deps').length,2);
  assert.match(result.stdout,/正式源未修改/);
});

const gitProbe=spawnSync('git',['--exec-path'],{encoding:'utf8'});
const gitOptions={skip:!pwsh?options.skip:gitProbe.status===0?false:'未安装 Git'};
async function gitFixture(t) {
  const f=await fixture(t);
  const git=(...args)=>{const r=spawnSync('git',args,{cwd:f.root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
  git('init','-q');git('config','user.name','Menu Test');git('config','user.email','menu@example.invalid');
  await fs.writeFile(path.join(f.root,'.gitignore'),'ci.ps1\nbin/\nmock.mjs\nspec.json\ncalls.jsonl\n');
  for(const name of ['a.txt','b.txt','delete.txt','old.txt'])await fs.writeFile(path.join(f.root,name),name+'\n');
  git('add','--','.gitignore','a.txt','b.txt','delete.txt','old.txt');git('commit','-qm','fixture');
  // Actions runners expose multiple Git applications (Windows bin/cmd, Linux /usr/bin and /bin).
  // Add a distinct directory alias so this case is also exercised on single-Git developer machines.
  const resolved=spawnSync(pwsh,['-NoProfile','-Command','(Get-Command git -CommandType Application | Select-Object -First 1).Source'],{encoding:'utf8'});
  assert.equal(resolved.status,0,resolved.stderr);
  // A trailing-slash ignore rule does not match a Unix symlink itself.
  // Keep the alias inside the ignored fixture tools directory on every platform.
  const alias=path.join(f.bin,'git-alias');
  await fs.symlink(path.dirname(resolved.stdout.trim()),alias,process.platform==='win32'?'junction':'dir');
  const menuPath=f.bin+path.delimiter+process.env.PATH+path.delimiter+alias;
  const discovery=spawnSync(pwsh,['-NoProfile','-Command','@(Get-Command git -CommandType Application).Count'],{encoding:'utf8',env:{...process.env,PATH:menuPath}});
  assert.equal(discovery.status,0,discovery.stderr);
  assert.ok(Number(discovery.stdout.trim())>=2,'fixture must expose multiple Git applications');
  assert.equal(git('status','--porcelain=v1','--untracked-files=all'),'','fixture tools must not appear as project changes');
  const execute=input=>f.execute([],input,{PATH:menuPath});
  return {...f,git,execute};
}

test('Git 多选只暂存选中文件，支持中文空格、特殊字符、删除与重命名',gitOptions,async t=>{
  const f=await gitFixture(t);
  await fs.writeFile(path.join(f.root,'a.txt'),'modified\n');
  await fs.writeFile(path.join(f.root,'b.txt'),'not selected\n');
  await fs.unlink(path.join(f.root,'delete.txt'));
  f.git('mv','old.txt','中文 空格[1].txt');
  await fs.writeFile(path.join(f.root,'-literal[1].txt'),'new\n');
  // sorted status: a, b, delete, rename, then untracked; toggle b off after selecting all.
  const result=await f.execute('8\n5\na\ndown\nspace\nenter\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  const staged=f.git('diff','--cached','--name-only','--no-renames','-z').split('\0').filter(Boolean).sort();
  assert.deepEqual(staged,['-literal[1].txt','a.txt','delete.txt','old.txt','中文 空格[1].txt'].sort());
  assert.match(f.git('diff','--name-only'),/b.txt/);
});

test('Git 提交拒绝未选择的已暂存文件；取消及空选保持索引',gitOptions,async t=>{
  for(const keys of ['space\nenter\n','a\nesc\n','enter\n']) {
    const f=await gitFixture(t);
    await fs.writeFile(path.join(f.root,'a.txt'),'modified a\n');
    await fs.writeFile(path.join(f.root,'b.txt'),'modified b\n');f.git('add','--','b.txt');
    const before=f.git('diff','--cached');
    const result=await f.execute(`8\n3\n${keys}\n0\n0\n`);
    assert.equal(result.code,0,result.stdout+result.stderr);
    assert.equal(f.git('diff','--cached'),before);
    assert.ok(!(await f.calls()).some(a=>a.join(' ')==='run commit'));
  }
});

test('Git 选择文件后调用既有 cz-git 脚本',gitOptions,async t=>{
  const f=await gitFixture(t);await fs.writeFile(path.join(f.root,'a.txt'),'modified\n');
  const result=await f.execute('8\n3\nspace\nenter\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  assert.ok((await f.calls()).some(a=>a.join(' ')==='run commit'),result.stdout);
  assert.equal(f.git('diff','--cached','--name-only').trim(),'a.txt');
});

test('批量识别失败不确认、不接受、不部分写入',options,async t=>{
  const f=await fixture(t,{failFile:'mods/b.jar',importItems:['a','b','c'].map(n=>({path:`mods/${n}.jar`,hash:'a'.repeat(64)}))});
  const result=await f.execute([],'3\n8\na\nenter\n\nd\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  const calls=(await f.commands()).filter(a=>a[0]==='import-deps');assert.equal(calls.length,2);
  assert.ok(!calls.some(a=>a.includes('--candidate')));
  assert.match(result.stdout,/fixture identification failure/);assert.match(result.stdout,/本批未导入/);
  assert.doesNotMatch(result.stdout,/\[y\/N/);
});

test('Collect 排除二进制与冲突，空的 Import 无选择和写入',options,async t=>{
  const f=await fixture(t,{managed:[{path:'config/binary',state:'runtime-only',diff:{binary:true}}],candidates:[{path:'config/new',state:'candidate',binary:true}]});
  const result=await f.execute([],'4\n3\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout);assert.match(result.stdout,/没有可选文件/);
  assert.ok(!(await f.commands()).some(a=>a.includes('--confirm')));
  const empty=await fixture(t,{importItems:[]}),other=await empty.execute([],'3\n8\n\n0\n0\n');
  assert.equal(other.code,0,other.stdout);assert.match(other.stdout,/没有需要识别/);
  assert.equal((await empty.commands()).filter(a=>a[0]==='import-deps').length,1);
});

test('直接批量 CLI 转发选择清单，不添加接受确认',options,async t=>{
  const f=await fixture(t),selection=path.join(f.root,'选中 mod 清单.json');
  await fs.writeFile(selection,JSON.stringify([{path:'mods/new.jar',hash:'a'.repeat(64)}]));
  const result=await f.execute(['import-deps','-Runtime','dev-a','-Selection',selection,'-Json']);
  assert.equal(result.code,0,result.stdout+result.stderr);
  assert.deepEqual((await f.commands()).at(-1),['import-deps','dev-a','--selection',selection,'--json']);
  assert.doesNotMatch(result.stdout,/\[y\/N|按 Enter 继续/);
});


test('进度必须在任务完成前显示，诊断只在 d 中显示，最终 JSON 仍可解析',options,async t=>{
  const f=await fixture(t,{progress:true}),ack=path.join(f.root,'ack');
  let acknowledged=false;
  const result=await f.execute([],'5\n1\n\nd\n\n0\n0\n',{MENU_ACK:ack},output=>{
    if(!acknowledged&&output.includes('fixture live progress')){acknowledged=true;fs.writeFile(ack,'continue');}
  });
  assert.equal(result.code,0,result.stdout+result.stderr);assert.ok(acknowledged);
  assert.doesNotMatch(result.stdout,/progress was buffered/);
  const pause=result.stdout.indexOf('按 Enter 继续');
  assert.match(result.stdout.slice(0,pause),/example.mrpack/);
  assert.doesNotMatch(result.stdout.slice(0,pause),/PAKKU-RAW-DIAGNOSTIC|@mp:/);
  assert.match(result.stdout.slice(pause),/PAKKU-RAW-DIAGNOSTIC/);
});
test('进度后的错误原因和退出码可见，操作失败仍暂停',options,async t=>{
  const f=await fixture(t,{progress:true,progressFailure:true}),ack=path.join(f.root,'ack');
  await fs.writeFile(ack,'continue');
  const result=await f.execute([],'5\n1\n\n0\n0\n',{MENU_ACK:ack});
  assert.match(result.stdout,/fixture progress failure/);assert.match(result.stdout,/退出码 37/);
  assert.match(result.stdout,/构建失败/);assert.match(result.stdout,/按 Enter 继续/);
});
test('纯文本与 Nerd Font 菜单保持同一层级，预览不能写入',options,async t=>{
  for(const mode of ['plain','nerd']) {
    const f=await fixture(t),result=await f.execute([],'2\n4\nn\n\n0\n2\n0\n3\n0\n4\n0\n5\n0\n6\n0\n7\n0\n8\n0\n0\n',{MP_ICONS:mode});
    assert.equal(result.code,0,result.stdout+result.stderr);
    for(const label of ['开发环境','同步到测试实例','预览同步变化','切换测试实例','切换整合包目标','配置与变化'])assert.ok(result.stdout.includes(label),label);
    if(mode==='plain')assert.doesNotMatch(result.stdout,/[\uE000-\uF8FF\u{1F000}-\u{1FAFF}]/u);
    else assert.match(result.stdout,/[\uE000-\uF8FF]/u);
    const calls=await f.commands();assert.ok(calls.some(a=>a[0]==='prepare'));
    assert.ok(calls.some(a=>a[0]==='dev'&&a.includes('--dry-run')));
    assert.ok(!calls.some(a=>a.includes('--stopped')||a.includes('--confirm')));
  }
});


test('显示设置预览三种模式，保存后即时刷新并跨会话记忆',options,async t=>{
  const f=await fixture(t),file=path.join(f.root,'.local/menu.json');
  for(const [number,mode,glyph] of [['2','nerd','\uf135'],['3','emoji','🚀'],['1','plain','']]) {
    const result=await f.execute([],`s\n${number}\n\n1\n0\n0\n`);
    assert.equal(result.code,0,result.stdout+result.stderr);
    for(const label of ['纯文本','Nerd Font','Emoji','图标若显示为方框'])assert.ok(result.stdout.includes(label));
    assert.equal(JSON.parse(await fs.readFile(file,'utf8')).icons,mode);
    const after=result.stdout.slice(result.stdout.indexOf('已切换为'));
    if(glyph)assert.ok(after.includes(glyph+' 开发环境'),after);
    else assert.doesNotMatch(after,/[\uE000-\uF8FF\u{1F000}-\u{1FAFF}]/u);
    const reopened=await f.execute([],'0\n');
    if(glyph)assert.ok(reopened.stdout.includes(glyph+' 开发环境'));
    else assert.doesNotMatch(reopened.stdout,/[\uE000-\uF8FF\u{1F000}-\u{1FAFF}]/u);
    assert.deepEqual((await fs.readdir(path.dirname(file))).sort(),['menu.json']);
  }
  assert.ok((await f.commands()).every(a=>a[0]==='status'));
});
test('显示设置取消不创建配置、不暂停、不额外查询状态且返回原页面',options,async t=>{
  const f=await fixture(t),result=await f.execute([],'3\ns\ninvalid\n0\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  assert.doesNotMatch(result.stdout,/按 Enter 继续/);assert.match(result.stdout,/请输入 0–3/);
  assert.ok(result.stdout.lastIndexOf('添加 Mod')>result.stdout.indexOf('选择显示模式'));
  await assert.rejects(fs.access(path.join(f.root,'.local/menu.json')));
  assert.equal((await f.commands()).length,1);
});
test('环境覆盖、本机配置损坏回退及直接模式不读取显示配置',options,async t=>{
  const f=await fixture(t),dir=path.join(f.root,'.local'),file=path.join(dir,'menu.json');await fs.mkdir(dir);
  await fs.writeFile(file,JSON.stringify({schema:1,icons:'nerd'}));
  let result=await f.execute([],'0\n',{MP_ICONS:'plain'});
  assert.doesNotMatch(result.stdout,/[\uE000-\uF8FF]/u);
  result=await f.execute([],'s\n3\n\n0\n',{MP_ICONS:'plain'});
  assert.match(result.stdout,/下次启动仍优先使用 MP_ICONS/);
  assert.ok(result.stdout.slice(result.stdout.indexOf('已切换为')).includes('🚀 开发环境'));
  for(const content of ['bad json',JSON.stringify({schema:99,icons:'nerd'}),JSON.stringify({schema:1,icons:'invalid'})]) {
    await fs.writeFile(file,content);result=await f.execute([],'0\n');
    assert.match(result.stdout,/本机显示配置无法读取/);assert.doesNotMatch(result.stdout,/[\uE000-\uF8FF]/u);
    assert.equal(await fs.readFile(file,'utf8'),content);
  }
  result=await f.execute(['status']);assert.equal(result.code,0);assert.doesNotMatch(result.stdout,/显示配置无法读取/);
  result=await f.execute([],'s\n1\n\n0\n',{MP_ICONS:'invalid'});
  assert.match(result.stdout,/MP_ICONS 无效/);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).icons,'plain');
});
test('显示配置保存失败不切换、不留下临时文件，并保留上次操作详情',options,async t=>{
  const f=await fixture(t),dir=path.join(f.root,'.local');await fs.mkdir(path.join(dir,'menu.json'),{recursive:true});
  const result=await f.execute([],'5\n1\n\ns\n2\n\nd\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  assert.doesNotMatch(result.stdout,/已切换为/);assert.match(result.stdout,/example.mrpack/);
  const tail=result.stdout.slice(result.stdout.lastIndexOf('Preliminary Art Form v2'));
  assert.doesNotMatch(tail,/[\uE000-\uF8FF]/u);
  assert.deepEqual(await fs.readdir(dir),['menu.json']);
  assert.match(result.stdout.slice(result.stdout.indexOf('选择显示模式')),/example.mrpack/);
});


test('创建工程入口与实例管理独立，空白工程预览后确认一次，无 Runtime 要求',options,async t=>{
  const f=await fixture(t,{bindings:[]}),result=await f.execute([],'1\n1\nNew Pack\nnew-pack\n1.21.1\n1\n0.16.14\n1\ny\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);assert.match(result.stdout,/创建整合包工程/);assert.match(result.stdout,/开发环境与实例/);
  const calls=(await f.commands()).filter(a=>a[0]!=='status');assert.equal(calls.length,2);
  assert.deepEqual(calls[0],['create-target','new-pack','--name','New Pack','--mc','1.21.1','--loader','fabric','--loader-version','0.16.14','--platform','modrinth']);
  assert.deepEqual(calls[1],[...calls[0],'--accept-hash','e'.repeat(64),'--confirm']);
  assert.equal((result.stdout.match(/\[y\/N/g)||[]).length,1);assert.match(result.stdout,/按 Enter 继续/);
});
test('MRPACK 创建先检查、再展示候选并统一确认；取消及无法转换不注册',options,async t=>{
  for(const answer of ['y','n']) {
    const f=await fixture(t,{bindings:[]}),result=await f.execute([],`1\n2\n中文 包.mrpack\nNew\nnew\n1\n${answer}\n\n0\n0\n`);
    assert.equal(result.code,0,result.stdout+result.stderr);
    const calls=(await f.commands()).filter(a=>a[0]!=='status');assert.equal(calls.length,answer==='y'?3:2);
    assert.deepEqual(calls[0],['inspect-pack','--file','中文 包.mrpack']);
    assert.ok(calls[1].includes('--file'));
    if(answer==='y')assert.deepEqual(calls[2],['create-target','new','--candidate','pack-candidate','--accept-hash','e'.repeat(64),'--confirm']);
    assert.ok(!calls.some(a=>['bind','apply','deploy'].includes(a[0])));
  }
  const f=await fixture(t,{badPack:true});const result=await f.execute([],'1\n2\nbad.mrpack\n\n0\n0\n');
  assert.match(result.stdout,/无法转换/);assert.ok(!(await f.commands()).some(a=>a[0]==='create-target'));
  const cancel=await fixture(t);const nav=await cancel.execute([],'1\n0\n0\n');assert.doesNotMatch(nav.stdout,/按 Enter 继续/);
});

test('九项主菜单与环境分组保持清晰，恢复、实例列表和 PCL2 绑定正确路由',options,async t=>{
  const f=await fixture(t),home=await f.execute([],'0\n');
  const labels=['创建整合包工程','开发环境与实例','Mod 管理','配置与变化','构建整合包','应用 CI / Release 构建','项目与环境检查','Git 提交','Pakku 高级操作'];
  for(const [i,label] of labels.entries())assert.ok(home.stdout.includes(`[${i+1}]  ${label}`),home.stdout);
  assert.doesNotMatch(home.stdout,/\[10\]/);
  const result=await f.execute([],'2\n5\nn\n\n5\ny\n\n7\n\n6\n1\npcl2-dev\nD:\\fixture\\game\n\nn\n\n0\n0\n');
  assert.equal(result.code,0,result.stdout+result.stderr);
  for(const group of ['当前环境','同步与恢复','实例管理'])assert.ok(result.stdout.includes(group));
  const calls=await f.commands();
  assert.deepEqual(calls.filter(a=>a[0]==='recover'),[['recover','dev-a','--target','a','--stopped']]);
  assert.equal(calls.filter(a=>a[0]==='runtimes').length,1);
  const binds=calls.filter(a=>a[0]==='bind');assert.equal(binds.length,1);
  assert.ok(binds[0].includes('pcl2')&&binds[0].includes('--dry-run'));
  assert.ok(!binds[0].includes('--confirm-game-dir'));
});

test('菜单配色区分序号、图标和正文，状态颜色保留语义，禁色不改变文本',options,async t=>{
  const f=await fixture(t),source=await fs.readFile(path.join(repo,'ci.ps1'),'utf8');
  // Load only display declarations/helpers; never run the interactive entry point.
  const prefix=source.slice(0,source.indexOf('function Initialize-Display'));
  const script=path.join(f.root,'colors.ps1');
  await fs.writeFile(script,prefix+`
$PSStyle.OutputRendering='Ansi'
$result=@()
foreach ($mode in @('plain','nerd','emoji')) {
    $script:IconMode=$mode
    $line="  [1] $(Get-UiIcon build) 构建整合包"
    $result+=@{plain=$line;colored=(Format-MenuText $line $true);disabled=(Format-MenuText $line $false);automatic=(Format-MenuText $line)}
}
$result+=@{status=(Format-MenuText '[成功] [警告] [错误]' $true)}
ConvertTo-Json -InputObject $result
`);
  const r=spawnSync(pwsh,['-NoProfile','-File',script],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
  const data=JSON.parse(r.stdout),strip=s=>s.replace(/\x1b\[[0-9;]*m/g,'');
  for(const item of data.slice(0,3)) {
    assert.equal(strip(item.colored),item.plain);
    assert.equal(item.disabled,item.plain);assert.equal(item.automatic,item.plain);
    assert.match(item.colored,/\x1b\[96m\[1\]\x1b\[39m/);
    assert.ok(item.colored.endsWith(' 构建整合包'));
  }
  for(const item of data.slice(1,3))assert.match(item.colored,/\x1b\[95m.+\x1b\[39m 构建整合包/);
  assert.match(data[3].status,/\x1b\[92m\[成功\]/);
  assert.match(data[3].status,/\x1b\[93m\[警告\]/);
  assert.match(data[3].status,/\x1b\[91m\[错误\]/);
  for(const env of [{NO_COLOR:'1'},{TERM:'dumb'}]) {
    const result=await f.execute([],'2\n0\n0\n',{...env,MP_ICONS:'nerd'});
    assert.equal(result.code,0,result.stdout+result.stderr);
    assert.doesNotMatch(result.stdout,/\x1b\[/);
    assert.match(result.stdout,/开发环境与实例/);
  }
});

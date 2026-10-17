import {probePowerShell} from './lib/powershell.mjs';
import fs from 'node:fs/promises';
import {createProject,inspectPack,packSummary} from './lib/create-project.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspace, selectTarget, safePath } from './lib/workspace.mjs';
import { bootstrap, verifiedTool, pakku, run, requireSuccess } from './lib/pakku.mjs';
import { checkTarget } from './lib/check.mjs';
import { build } from './lib/build.mjs';
import { bindRuntime, unbindRuntime, runtimes, getRuntime } from './lib/runtimes.mjs';
import { prepare } from './lib/prepare.mjs';
import { deploy, recover } from './lib/deploy.mjs';
import { changes, formatChanges } from './lib/changes.mjs';
import { collect } from './lib/collect.mjs';
import { reviewDependencies, acceptDependencies, restoreDependencies } from './lib/dependencies.mjs';
import { importDependencies } from './lib/import-dependencies.mjs';
import { status } from './lib/status.mjs';
import { apply } from './lib/apply.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const command = args.shift() ?? 'help';
const help = `Preliminary Art Form v2
pnpm run mp -- <命令>
  help                         中文帮助
  bootstrap                    显式下载并校验固定 Pakku（可重复）
  doctor                       只读检查 Node/pnpm/Git/Java/Pakku/PowerShell
  inspect-pack --file <包.mrpack>  只读验证包与转换范围，不绑定 Runtime
  create-target <id> --name <工程名> --platform modrinth|curseforge|multiplatform
       --mc <版本> --loader fabric|forge|neoforge|quilt --loader-version <版本>
       默认预览；--accept-hash <预览哈希> --confirm 才初始化并注册
       或 --file <包.mrpack> --platform modrinth  生成隔离转换候选
       --candidate <候选ID> --accept-hash <预览哈希> --confirm  接受工程候选
  targets                      列出所有 Target
  use <id>                     选择本机默认 Target（仅写 .local）
  list [--target <id>]          原生 Pakku ls
  add <slug> [--target <id>]    原生 Pakku add
  remove <slug> [--target <id>] 原生 Pakku rm
  update [slug] [--target <id>] 原生 Pakku update，无 slug 时 --all
  check [--target <id>|--all]   只读检查源文件和 Pakku 数据
  build --target <id>          在 .work 副本 export，收集到 dist/<id>/build-*
  pakku --target <id> -- <原生参数...>  直接调用，可能修改目标
  prepare --target <id>         在副本 export，准备客户端部署清单
  bind <name> --launcher pcl2|hmcl --target <id> --game-dir <绝对目录>
       [--version-dir <版本目录>] [--dry-run|--confirm-game-dir]
  runtimes                     列出本机绑定（含本机绝对路径）
  unbind <name>                仅移除绑定，保留游戏文件/基线/备份
  deploy <name> --dry-run      读取当前已准备清单，预览而不写文件
  deploy <name> --stopped      确认游戏已关闭后安全增量部署
       [--adopt-existing]      仅显式接管内容完全相同的现有文件
  recover <name> --stopped     从 journal/备份恢复失败部署
  changes <name> [--json]      比较源文件、实例与上次部署，查看 Mod 变化
  collect <name> [--json]      只读文件清单及文本差异预览
       --file <运行相对路径> --confirm --stopped  明确回收一个文件
       [--delete]             明确接受已受管文件的实例删除
       [--source <源相对路径>] 新 config 候选必须指定 manual override 来源
  import-deps <name> [--json]  列出 Runtime 中未匹配当前锁文件的启用 JAR
       --selection <JSON文件>  批量生成单一候选，内容为 [{"path":"mods/a.jar","hash":"扫描SHA256"}]
       --file mods/<文件>.jar --sha256 <扫描哈希>  用 Pakku 生成导入候选
       --candidate <id> --accept-hash <候选哈希> --confirm  接受已审查候选
  deps-review <name> --operation add|remove --project <ID/slug>
                               完整 Pakku 副本生成候选，人工核实来源/许可
  deps-accept <name> --candidate <id> --accept-hash <SHA256> --confirm
                               仅接受已审查候选锁文件，不复制 JAR
  restore-deps <name>          只读恢复正式依赖预览
       --confirm --stopped [--file mods/<额外或禁用 JAR>]
                               备份后修复受管依赖；仅点选额外 JAR 移入备份
  dev <name> --stopped         Deploy 后显示手动启动提示
  status [--light]            完整状态；--light 仅读取选择、绑定和部署元数据
  apply <name> --file <包.mrpack> [--dry-run]
       或 --repo owner/repo --run <Run ID>
       或 --repo owner/repo --release release/<target>/v<version>
       默认只读预览（远端入口联网读取，需 GH_TOKEN 权限）
       --sha256 <已审查包的 SHA256> --confirm --stopped  才执行
       [--adopt-existing]      只接管内容相同文件；本地包需同目录报告和 SHA256SUMS
菜单进度：环境变量 MP_PROGRESS=jsonl 启用 stderr 阶段事件，stdout 结果格式不变。
选项 --java <可执行文件>，或环境 MP_JAVA，默认 PATH 的 java。
多目标未选择时要求 --target/use；单目标自动选中。bootstrap 之外不隐式下载工具。
CI 提供预览产物；Release 只创建草稿。不安装或自动启动游戏。
部署前必须停止游戏；--stopped 不能绕过已检测到的游戏进程。`;

try {
  if (command === 'help') { console.log(help); }
  else {
    const options = {}, positional = [];
    let explicit, all = false, native = [];
    while (args.length) {
      const arg = args.shift();
      if (arg === '--' && command === 'pakku') { native = args.splice(0); break; }
      if (['--target','--java','--launcher','--game-dir','--version-dir','--file','--source','--operation','--project','--candidate','--accept-hash','--run','--repo','--release','--sha256','--selection','--name','--mc','--loader','--loader-version','--platform'].includes(arg)) {
        const value = args.shift();
        if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少值`);
        if (arg === '--target') { if (explicit) throw new Error('重复 --target'); explicit = value; }
        else {const key={'--java':'java','--launcher':'launcher','--game-dir':'gameDir','--version-dir':'versionDir','--file':'file','--source':'source','--operation':'operation','--project':'project','--candidate':'candidate','--accept-hash':'acceptHash','--run':'run','--repo':'repo','--release':'release','--sha256':'sha256','--selection':'selection','--name':'name','--mc':'mc','--loader':'loader','--loader-version':'loaderVersion','--platform':'platform'}[arg];if(options[key])throw new Error(`重复 ${arg}`);options[key]=value;}
      } else if (arg === '--all' && command === 'check') all = true;
      else if (['--dry-run','--confirm-game-dir','--stopped','--adopt-existing','--json','--light','--confirm','--delete'].includes(arg)) options[{'--dry-run':'dryRun','--confirm-game-dir':'confirmGameDir','--stopped':'stopped','--adopt-existing':'adoptExisting','--json':'json','--light':'light','--confirm':'confirm','--delete':'delete'}[arg]]=true;
      else if (arg.startsWith('-')) throw new Error(`未知参数 ${arg}`);
      else positional.push(arg);
    }
    if (all && explicit) throw new Error('--all 与 --target 不能同时使用');
    if (!['create-target','inspect-pack','bootstrap','doctor','targets','use','list','add','remove','update','check','build','pakku','prepare','bind','runtimes','unbind','deploy','recover','changes','collect','import-deps','deps-review','deps-accept','restore-deps','dev','status','apply'].includes(command)) throw new Error(`未知命令 ${command}，运行 mp help`);
    const allowed = {name:['create-target'],mc:['create-target'],loader:['create-target'],loaderVersion:['create-target'],platform:['create-target'],launcher:['bind'],gameDir:['bind'],versionDir:['bind'],dryRun:['bind','deploy','dev','apply'],confirmGameDir:['bind'],stopped:['deploy','recover','dev','collect','restore-deps','apply'],adoptExisting:['deploy','dev','apply'],json:['changes','collect','status','import-deps'],light:['status'],confirm:['create-target','collect','import-deps','deps-accept','restore-deps','apply'],delete:['collect'],file:['create-target','inspect-pack','collect','restore-deps','apply','import-deps'],source:['collect'],operation:['deps-review'],project:['deps-review'],candidate:['create-target','deps-accept','import-deps'],acceptHash:['create-target','deps-accept','import-deps'],run:['apply'],repo:['apply'],release:['apply'],sha256:['apply','import-deps'],selection:['import-deps']};
    for (const key of Object.keys(options)) if (allowed[key] && !allowed[key].includes(command)) throw new Error(`${command} 不支持 ${key}`);
    const expected = ['create-target','use','add','remove','bind','unbind','deploy','recover','changes','collect','import-deps','deps-review','deps-accept','restore-deps','dev','apply'].includes(command) ? 1 : 0;
    if (positional.length !== expected && !(command === 'update' && positional.length <= 1)) throw new Error(`${command} 参数数量错误`);
    const w = await loadWorkspace(root);
    if (explicit && !w.targets.some(t => t.id === explicit)) throw new Error(`未知 Target: ${explicit}`);
    options.report = value => console.log(JSON.stringify(value,null,2));
    if(['create-target','inspect-pack'].includes(command)) {
      if(explicit)throw new Error('创建工程不使用 --target；请通过位置参数指定新 Target ID');
      const result=command==='inspect-pack'?packSummary(await inspectPack(options.file)):await createProject(root,positional[0],options);
      options.report(result);if(result.blocked)process.exitCode=1;
    }
    else if(command==='status')options.report(await status(root,w,options));
    else if(['changes','collect','import-deps','deps-review','deps-accept','restore-deps'].includes(command)) {
      const runtime=await getRuntime(root,positional[0]);
      if(explicit && explicit!==runtime.targetId)throw new Error('--target 与 Runtime 绑定不符');
      const target=await selectTarget(root,w,runtime.targetId),jsonReport=options.report;
      options.report=value=>{if(!options.json)console.log(value.managed?formatChanges(value):JSON.stringify(value,null,2));};
      const result=command==='import-deps'?await importDependencies(root,runtime,target,options):command==='changes'?await changes(root,runtime,target):command==='collect'?await collect(root,runtime,target,options):command==='deps-review'?await reviewDependencies(root,runtime,target,options):command==='deps-accept'?await acceptDependencies(root,target,options):await restoreDependencies(root,runtime,target,options);
      if(result.blocked)process.exitCode=1;
      if(options.json)jsonReport(result.report??result);
      else if(command==='changes')console.log(formatChanges(result));
      else if(!result.preview)jsonReport(result);
    } else if (command === 'bind') {
      if (!explicit) throw new Error('bind 必须明确 --target');
      await bindRuntime(root,await selectTarget(root,w,explicit),positional[0],options);
    } else if (command === 'runtimes') options.report(await runtimes(root));
    else if (command === 'unbind') {console.log(`计划: 解除 ${positional[0]} 的绑定，不删除游戏或基线`);options.report(await unbindRuntime(root,positional[0]));}
    else if (['deploy','recover','dev','apply'].includes(command)) {
      const runtime=await getRuntime(root,positional[0]);
      if(explicit && explicit!==runtime.targetId)throw new Error('--target 与 Runtime 绑定不符');
      const target=await selectTarget(root,w,runtime.targetId);
      console.log(`计划: ${command} ${runtime.id}${options.dryRun?'（只读）':''}`);
      options.report(command==='apply'?await apply(root,runtime,target,options):command!=='recover'?await deploy(root,runtime,target,options):await recover(root,runtime,options));
      if(command==='dev'&&!options.dryRun)console.log(`部署完成。请在 ${runtime.launcher} 中手动启动 ${runtime.versionId}；退出游戏后运行 mp changes ${runtime.id}。`);
    } else if (command === 'prepare') {
      if(!explicit)throw new Error('prepare 必须明确 --target');
      console.log(`计划: 隔离准备 ${explicit} 的客户端清单`);
      const result=await prepare(root,await selectTarget(root,w,explicit),options);
      options.report({target:explicit,fingerprint:result.fingerprint,files:result.files,directory:result.directory});
    } else if (command === 'bootstrap') { console.log('计划: 校验缓存，缺失时下载固定 Pakku'); console.log((await bootstrap(root)).jar); }
    else if (command === 'targets') console.log(JSON.stringify(w.targets, null, 2));
    else if (command === 'doctor') {
      const t = await verifiedTool(root);
      if (process.versions.node.split('.')[0] !== '24') throw new Error('需要 Node 24');
      const java = requireSuccess(await run(options.java ?? process.env.MP_JAVA ?? 'java', ['-version'], { capture: true }));
      if (!/version "21\./.test(java.stderr + java.stdout)) throw new Error('模板验证基线为 Java 21，请通过 --java 或 MP_JAVA 指定');
      const git = requireSuccess(await run('git', ['--version'], { capture: true }));
      const version = requireSuccess(await pakku(root, root, ['--version'], { ...options, capture: true }));
      if (!version.stdout.includes(t.version)) throw new Error('Pakku 版本不匹配');
      const agent = process.env.npm_config_user_agent ?? '';
      if (!agent.startsWith(`pnpm/${t.chain.pnpm} `)) throw new Error(`请使用 pnpm ${t.chain.pnpm} run mp -- doctor`);
      const powershell=probePowerShell();
      console.log(JSON.stringify({powershell,node:process.version,pnpm:agent.split(' ')[0],java:(java.stderr+java.stdout).trim(),git:git.stdout.trim(),pakku:version.stdout.trim(),sha256:t.sha256},null,2));
    } else if (command === 'use') {
      const target = await selectTarget(root, w, positional[0]);
      const file = await safePath(root, '.local/selection.json');
      console.log(`计划: 本机选择 ${target.id}`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({target:target.id},null,2)+'\n');
    } else if (command === 'check') {
      for (const target of all ? w.targets : [await selectTarget(root,w,explicit)]) {
        await checkTarget(root,target,options); console.log(JSON.stringify({target:target.id,check:'passed'}));
      }
    } else {
      if (command === 'build' && !explicit) throw new Error('build 必须明确 --target');
      const target = await selectTarget(root,w,explicit);
      if (command === 'build') { console.log(`计划: 隔离构建 ${target.id}`); await build(root,target,options); }
      else {
        const map = {list:'ls',add:'add',remove:'rm',update:'update'};
        const forwarded = command === 'pakku' ? native : [map[command], ...positional, ...(command === 'update' && !positional.length ? ['--all'] : [])];
        if (!forwarded.length) throw new Error('pakku 需要 -- <原生参数>');
        console.log(`调用 ${target.id}: pakku ${forwarded.join(' ')}`);
        requireSuccess(await pakku(root,await safePath(root,target.path),forwarded,options));
      }
    }
  }
} catch (e) { console.error(`错误: ${e.message}`); process.exitCode = e.exitCode ?? 1; }

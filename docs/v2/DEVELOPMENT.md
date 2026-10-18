# 开发指南

本仓库使用 Pakku 管理 Preliminary Art Form，仅交付 Modrinth `.mrpack`。当前正式目标是 `client-26.2`，保持 Minecraft 26.2 / Fabric 0.19.5 / A1.3.1；不保留旧 packwiz 入口。

从 v1 迁移后，`scripts/pack.ps1` 对应 `ci.ps1` / `mp`，`instances.json` 对应 `workspace.json`，依赖描述转为 Pakku 配置和锁文件。修改 overrides 无需 refresh，执行 check 和 build 即可。

正式默认配置位于 `packs/client-26.2/.pakku/client-overrides/config/yosbr/`。只维护 YoSBR 默认设置，避免重新引入过时的根 options。内嵌文件的来源与迁移哈希见[迁移审计](MIGRATION-V2-AUDIT.json)。


## Windows 统一入口

安装 README 中的环境和依赖后，在 PowerShell 7.3 或更新版本执行 `.\ci.ps1`。入口使用新版原生参数传递方式，以保留参数中的引号和空格。输入编号操作，`0` 返回上一级，`d` 查看上次操作的完整输出。菜单显示当前目标、实例、启动器和 Git 状态；没有绑定实例时仍可管理依赖、检查或构建。

Collect、实例依赖导入和 Git 暂存/提交使用多选列表：↑ / ↓ 移动，Space 选择或取消，A 全选，N 全不选，Enter 确认，Esc 返回。初始不选任何文件；列表显示已选数量，超过一屏时随光标滚动。其他菜单仍输入数字。

操作默认显示数量、对象和结果摘要。完整差异、哈希和 CLI 日志保留在 `d` 中；写入确认提示也支持输入 `d`，查看后再回答。明确选择“查看指定文件差异”时直接显示该文件差异；Pakku 原生交互和 cz-git 保留各自提示。

叶子操作结束后会显示结果，按 Enter 才返回菜单；成功、无结果、取消和失败均可先阅读输出。翻页不暂停，直接命令不暂停。

主菜单使用 1–9：创建整合包工程、开发环境与实例、Mod 管理、配置与变化、构建、应用构建、检查、Git、Pakku 高级操作。

“开发环境与实例”按当前环境、同步与恢复、实例管理分组；绑定实例时选择 PCL2 或 HMCL，查看和解绑也在此页。在这里分别切换 Target 或 Runtime。目标沿用 `mp use` 的本机设置；一个目标只有一个绑定时自动选用，多个绑定时手动选择，并在当前菜单会话中保留。切换目标不会继续使用另一个目标的实例。

“开发环境与实例”中的“同步到测试实例”会先预览，再确认写入；“预览同步变化”仅准备本地清单和显示计划，不写入游戏目录。Target 与 Runtime 仍分别切换。“配置与变化”集中提供变化列表、指定文件差异、Collect、新配置审查和依赖偏离检查。

长任务实时显示正在执行的阶段，例如校验目标、等待 Pakku、校验候选、备份和写入。没有可用的细粒度进度时仅显示等待状态，不估算百分比。最终显示摘要；原始 Pakku 输出和完整结果保存在当前会话的 `d` 中。Pakku 原生交互和 cz-git 继续直接连接终端。

菜单序号和快捷键使用青色，图标使用紫色，分组标题使用深青色，正文沿用终端默认前景色；成功、警告、错误分别使用绿、黄、红。Emoji 可能保留字体自带的颜色，Nerd Font 图标可以随前景色着色。重定向输出、`NO_COLOR` 或 `TERM=dumb` 环境下菜单装饰色自动关闭。

默认使用纯文本图标模式（不显示装饰图标，仍保留颜色）。在任意菜单按 `s` 打开“显示设置”，可预览纯文本、Nerd Font 和 Emoji 样例；输入编号立即应用并记住选择，按 Enter 返回原页面。输入 `0` 取消不会保存或暂停。Nerd Font 模式需要终端已配置相应字体；若样例显示方框或错位，选择纯文本。

选择保存在本仓库的 `.local/menu.json`，不进入 Git，不影响其他仓库，也不修改终端字体。首次使用不创建配置；配置无效时提示并回退纯文本，可重新选择覆盖。显示设置保留上次操作的 `d` 详情。

启动时优先使用环境变量 `MP_ICONS`（`plain` / `nerd` / `emoji`），其次读取本机选择。菜单内选择会立即覆盖当前会话，但下次启动仍以环境变量为准。要沿用记住的选择，在当前 PowerShell 中运行：

```powershell
Remove-Item Env:MP_ICONS -ErrorAction SilentlyContinue
.\ci.ps1
```

直接 CLI 模式不读取或保存显示设置。显示模式不改变键盘操作或颜色降级规则，不自动检测或安装字体。

菜单通过 `status --light` 一次读取目标、绑定、Git 状态和本地部署元数据，不遍历游戏目录或计算文件哈希。完整 `status`、Changes 和依赖变化检查只在明确选择相应操作时执行。翻页时复用已读取的状态，执行操作后自动刷新。在其他终端修改了目标、实例绑定或 Git 文件时，按 `r` 手动刷新菜单状态。

在 VS Code 中按 `Ctrl+Shift+B` 弹出任务选择菜单，可选择开发菜单、检查全部目标、运行自动测试或规范提交；也可通过“终端 → 运行任务”选择。提交前先在源代码管理面板暂存文件。这些任务使用 PowerShell 7，并从仓库根目录运行。

部署前先准备清单并预览；准备会写入本地临时目录。确认游戏已关闭后才写入实例。配置回收可多选，逐项确认写入；删除和新配置来源单独确认。配置回收遇到错误会停止，已完成项保留。依赖导入在多选后自动批量识别，统一审查并确认一次；有识别失败或冲突时整批不写入。Apply 先显示来源与变更数量，详细输出可查看包哈希；确认后将同一哈希交给 CLI 校验。

直接模式适合重复操作或脚本调用：

```powershell
.\ci.ps1 help
.\ci.ps1 status
.\ci.ps1 check -All
.\ci.ps1 build -Target client-26.2
.\ci.ps1 changes -Runtime hmcl-dev
.\ci.ps1 deploy -Runtime hmcl-dev -Target client-26.2 -Stopped
.\ci.ps1 mp -- collect hmcl-dev --file config/yosbr/config/zoomify.json --confirm --stopped
```

直接模式不询问确认，缺少底层必需参数时会报错或仅预览，失败退出码保持不变。`mp --` 后按标准 CLI 参数原样转发；含空格路径用引号包围。菜单的 Pakku 高级操作逐个收集参数，不解析 shell 命令。

“Git 提交”可以只暂存所选文件，或暂存后进入 cz-git；选择文件表示包含该文件的全部修改，不提供分块暂存。已有暂存内容保持原样；提交时若暂存区包含未选中的文件，会停止操作，需一并选择或先在编辑器中调整。提交使用现有 cz-git / commitlint，不推送。缺少工具时菜单给出安装提示，不自动安装环境。

## 环境诊断

`pnpm run mp -- doctor` 检查工具版本，并报告 PowerShell 是否可执行、版本和实际进程路径。工具 Java 固定为 Java 21；游戏 Java 由 Minecraft、Loader 和 Mod 的要求决定，由启动器单独配置。

Windows 的 `pwsh` 可能指向应用执行别名。若路径存在但无法启动，查看 `Get-Command pwsh -All`，确认实际安装路径；可在当前终端显式指定：

```powershell
$env:MP_PWSH = 'C:\Tools\PowerShell\pwsh.exe' # 替换为实际路径
pnpm run mp -- doctor
& $env:MP_PWSH -NoProfile -File .\ci.ps1
```

`MP_PWSH` 用于 Node 发起的 PowerShell 诊断、菜单测试和 Windows 进程查询，不安装 PowerShell、不修改系统 PATH。未指定时诊断仅检查 PATH 中的候选，不搜索下载缓存；如前面的别名失败但后面的安装可用，会同时列出失败路径与实际可执行路径。PowerShell 不可用时 doctor 仍报告其他工具状态，部署的游戏运行检查不会因此被绕过。

若 Git 报 `detected dubious ownership`，先确认仓库来源、当前用户和目录所有者。优先修正目录归属；确实需要访问可信的共享目录时，可仅对一次 Git 调用指定该目录：

```powershell
git -c safe.directory='D:/Projects/My-Pack' -C 'D:/Projects/My-Pack' status
```

这个参数只对该次调用有效，不会让后续 pnpm 命令自动获得信任。不要使用 `safe.directory=*`；模板不会替用户修改全局信任设置。

## 管理目标

`workspace.json` 中每个条目对应一个独立 Pakku 工程：

```json
{
  "targets": [
    {
      "id": "client-26.2",
      "path": "packs/client-26.2",
      "artifacts": ["modrinth"]
    }
  ]
}
```

`id` 使用小写字母、数字、点或连字符；`path` 位于 `packs/` 下且不能互相嵌套。`artifacts` 指定需要收集的包类型，可选 `modrinth`、`curseforge`、`serverpack`，必须与 Pakku 实际导出结果相符。

目标选择顺序为：命令的 `--target` → 本机 `use` 选择 → `workspace.json` 的可选字段 `defaultTarget` → 唯一目标。构建和准备部署清单始终要求显式指定目标。

修改包信息（需要发布新版本时执行）：

```powershell
pnpm run mp -- pakku --target client-26.2 -- cfg --name My-Pack --version 0.1.0
```

在主菜单选择“创建整合包工程”（编号 1），可新建空白工程或从本地 MRPACK 转换。这与“开发环境与实例”和“应用 CI / Release 构建”不同：这里只创建 `packs/<Target ID>/` 并注册到 `workspace.json`，不需要游戏目录。

空白工程输入名称、Target ID、Minecraft 版本、Loader 和版本，再选择 Modrinth、CurseForge 或 Multiplatform。版本由用户明确输入；初始包版本为 `0.1.0`。预览只读，确认后调用固定 Pakku 的原生 `init`，检查通过才注册。目录已存在、Target 重复或工作区在确认期间变化时拒绝创建。含 CurseForge 的后续依赖操作可能需要平台凭据。

CLI 也可分两步使用；第二步把 `<预览哈希>` 替换为第一次输出的 `acceptHash`：

```powershell
pnpm run mp -- create-target my-pack --name My-Pack --mc 1.21.1 --loader fabric --loader-version 0.16.14 --platform modrinth
pnpm run mp -- create-target my-pack --name My-Pack --mc 1.21.1 --loader fabric --loader-version 0.16.14 --platform modrinth --accept-hash <预览哈希> --confirm
```

MRPACK 导入先校验文件，再在 `.work/` 生成候选并联网识别依赖。展示转换结果后只确认一次；确认时再次校验原包、候选和工作区，检查通过后才写入正式目录并注册。取消时正式源不变，候选留在可清理的 `.work/create-*/` 中；原包始终只读。

```powershell
pnpm run mp -- inspect-pack --file 'D:\Downloads\Example.mrpack'
pnpm run mp -- create-target imported-pack --name Imported-Pack --platform modrinth --file 'D:\Downloads\Example.mrpack'
pnpm run mp -- create-target imported-pack --candidate <候选ID> --accept-hash <预览哈希> --confirm
```

转换范围与限制：

- MRPACK v1、Minecraft、单个 Fabric / Forge / NeoForge / Quilt Loader；目前只允许导入为 Modrinth Target，避免跨平台版本匹配改变原文件。
- 依赖由 Pakku 原生 `import` 按哈希识别；逐项核对 SHA-512、SHA-1，再通过原生 `cfg prj` 设置客户端/服务端侧别并固定版本（`NONE` 更新策略）。不自动补充原包未列出的依赖。下载地址采用 Pakku 识别出的平台地址，不照搬未知来源。
- 公共、客户端、服务端覆盖文件分别放入 `.pakku/overrides`、`.pakku/client-overrides`、`.pakku/server-overrides`；同名文件保留原来的覆盖优先级。空目录记录会报告为跳过。
- 转换后实际导出 MRPACK，对照原包的依赖路径、哈希、大小、侧别和覆盖文件内容。无法识别的索引依赖、可选侧别、非标准字段、路径差异或导出漂移会明确报告并阻止整批注册；不会悄悄丢弃内容。先在原包中明确处理这些项目，再重新导入。内嵌 JAR、资源包和光影作为本地 overrides 原样保留，不伪造托管项目；导出时仍核对原始内容哈希。
- 初始化、转换或注册失败会清理本次新建内容，保留原工作区；并发修改工作区时停止，不覆盖他人的改动。不要在创建期间手动编辑候选或目标目录。

完成后运行 `mp use <Target ID>`，添加依赖或覆盖资源，并执行 check 与 build。完整转换报告和 Pakku 输出可在菜单按 `d` 查看。这里 Pakku 的 `--target` 指发布平台；创建命令的 `--platform` 明确区分该含义，已有 `mp --target` 仍用于选择工作区目标。

移除目标时，删除清单中的条目并处理对应源目录；若本机选中过它，重新运行 `use`。每个目标独立维护 Minecraft、加载器和 Mod 版本，不通过修改锁文件复制版本组合。

## Mod 与 Pakku

```powershell
pnpm run mp -- list --target client-26.2
pnpm run mp -- add sodium --target client-26.2
pnpm run mp -- update sodium --target client-26.2
pnpm run mp -- remove sodium --target client-26.2
```

`update` 不带项目名时更新所选目标的全部依赖。修改后检查 `pakku.json` 和 `pakku-lock.json` 的 Git 差异。更多原生操作通过 `mp pakku --target <目标名> -- <参数>` 调用。实例中新增的 Mod 可通过“Mod / 依赖管理 → 从实例导入新增依赖”识别并导入，流程见[启动器同步](LAUNCHER_SYNC.md#导入实例新增依赖)。

Pakku 固定版本与 SHA-256 见 [toolchain.json](../toolchain.json)。独立调用 Pakku 1.5.0 时，先进入目标目录，再传入 `--working-path .`；绝对 working-path 在目录覆盖规则下存在路径兼容问题。可用参数以该版本的 `--help` 和[官方文档](https://github.com/juraj-hrivnak/Pakku/tree/v1.5.0/docs/topics)为准。

## 配置和资源

可以在 `pakku.json` 中用 `overrides`、`client_overrides`、`server_overrides` 声明文件或目录，也可以直接放入以下目录：

| 目录 | 用途 |
| --- | --- |
| `.pakku/overrides/` | 公共文件 |
| `.pakku/client-overrides/` | 客户端文件 |
| `.pakku/server-overrides/` | 服务端文件 |

客户端同名覆盖文件优先于公共文件。本项目将正式资源放在 `.pakku/client-overrides/`；临时测试工程另行覆盖公共和服务端规则。调整文件位置时同步更新规则，避免引用已删除路径。

模板检查器只接受明确的文件或目录规则，不支持 glob 通配符；需要随包分发的本地 JAR 应放入正式 overrides。不要将游戏目录整体复制为源工程。复用已有整合包时，通过 Pakku 添加依赖，再逐项复制需要分发的配置和资源。

## 检查与构建

```powershell
pnpm test
pnpm run mp -- check --all
pnpm run mp -- build --target client-26.2
```

`check` 检查目录、覆盖规则、文件边界和 Pakku 数据，不更新依赖。`build` 在 `.work/` 副本执行 export，检查归档内容与覆盖文件哈希后，将结果放入 `dist/<目标名>/build-*/`。失败时保留构建副本，便于查看错误。空白服务端包可以是合法的空 ZIP；不同平台产物同名时，后收集的产物加平台前缀，避免覆盖。

`build-report.json` 记录目标、Git 提交、文件哈希与 `dirty` 状态；`dirty: true` 表示构建时有未提交改动。本地允许此类构建，CI 发布要求源文件已提交。

单元测试的数据独立于正式 `packs/`，可删除或改名示例 Target 后继续测试。菜单测试要求 PowerShell 7.3+；本地缺少环境时会列出跳过原因，结束时应检查通过、失败和跳过数量。CI 设置 `MP_REQUIRE_MENU_TESTS=1`，菜单环境不可用会直接失败；仅适用于某个操作系统的测试仍可在其他系统跳过。

原生 Pakku 集成验证需要联网和已通过 `bootstrap` 校验的工具，全部使用临时工程及模拟实例：

```powershell
pnpm exec node tools/verify-import.mjs
pnpm exec node tools/verify-runtime-import.mjs
pnpm exec node tools/verify-phase1.mjs
pnpm exec node tools/verify-phase2.mjs
pnpm exec node tools/verify-phase3.mjs
pnpm exec node tools/verify-phase4.mjs
```

`verify-runtime-import` 使用固定版本的 Radial 与 Renice Shot，验证真实 Pakku 批量导入、配置默认值省略、取消、失败与双文件写入回滚。配置与 Lock 共同绑定候选审查哈希；仅允许 Pakku 1.5.0 序列化时省略已知默认值，其他配置变化仍拒绝。二者在同一备份目录保留写入前后内容；写入失败会回滚，进程意外中断或回滚失败时须先检查提示的备份，后续导入会暂停。

`verify-import` 使用固定 ServerCore 版本，验证 MRPACK 导入后的 SERVER 侧别、文件哈希及客户端部署排除。`verify-phase1` 额外检查正式目标及覆盖文件，并确认已跟踪和未跟踪源文件未变；其余同步、回收、依赖审查、Apply 和 CI 验证使用 Pakku 初始化的临时工程。失败时会输出临时目录供检查，网络失败不会当成测试通过。

修改 CLI 时运行 `pnpm test`；涉及 Pakku、导出或公共目标逻辑时，再执行 check 和对应构建。自动测试使用临时文件及模拟实例，游戏内效果需要在启动器中验证。

归档读取上限为压缩包 512 MiB、单文件 256 MiB、解压总量 1 GiB、20,000 个条目，不支持 ZIP64、加密包和符号链接。单个依赖下载上限为 512 MiB。超出限制时命令会报错。

下一步见[启动器同步](LAUNCHER_SYNC.md)；CI 与发布配置见[构建与发布](RELEASE.md)。

## 随包分发本地资源

没有托管下载地址的 Mod、自制资源包和光影可以直接放入 Target 的正式覆盖目录：

- `.pakku/overrides/mods/local.jar`：客户端与服务端共用。
- `.pakku/client-overrides/resourcepacks/local.zip`：仅客户端资源包。
- `.pakku/client-overrides/shaderpacks/local.zip`：仅客户端光影。
- `.pakku/server-overrides/mods/local-server.jar`：仅服务端 Mod。
- 解包资源包也可放在 `.pakku/client-overrides/resourcepacks/<包名>/`，其中的 `assets/` 会保留。

这些目录下明确维护的资源和配置可正常加入 Git；只保存确实需要分发且拥有分发许可的资源。Pakku 在构建时打包，Workspace 核对内容哈希。客户端、公共和服务端内容继续分别处理，不会无条件合并。资源文件不进入 Pakku 托管依赖列表，不支持自动更新；更新时替换仓库中的文件，再检查、构建和同步。Runtime Import 跳过已由 overrides 管理的 Mod 路径，Collect 仍不自动回收 JAR 或归档。

也可用 Pakku 的 overrides 配置明确声明其他源目录；Git 默认归档例外仅覆盖上述标准目录，自定义位置需自行添加精确的 `.gitignore` 例外。未声明的散落归档、工具缓存和构建产物仍不作为源资源。游戏根目录的 assets、存档、账户、凭据、启动器文件及路径穿越仍受保护。归档大小限制见上文；本地检查和构建通过不代表托管平台已批准发布，上传时仍需符合平台的分发规则。

## 内容与安全边界

正式 overrides 表示作者明确选择分发的内容，与 Runtime 中自动发现的玩家文件分开处理。路径与内容规则集中在 `tools/lib/content-policy.mjs`；检查、归档导入、同步和回收复用这些规则。

| 内容或操作 | 当前策略 |
| --- | --- |
| 默认游戏设置 | 允许 `options.txt`、`optionsof.txt`、`optionsshaders.txt`，推荐放入 `.pakku/client-overrides/` |
| 配置与脚本 | 允许根目录 JSON、`server.properties`、`servers.dat`、KubeJS、CraftTweaker、启动脚本及辅助二进制；模板只复制/打包，不执行这些文件 |
| 本地资源 | 允许 JAR、ZIP、图片、公开证书等；不单凭扩展名或 accounts/launcher/hmcl 等关键词拒绝 |
| 模板与示例目录 | 允许 `config/template/assets/`、`config/template/saves/` 和资源包内部 assets；不等于允许覆盖玩家根目录的同名目录 |
| 玩家与启动器目录 | 游戏根目录的 saves、logs、crash-reports、screenshots、assets、libraries、versions、PCL、HMCL、.minecraft 不纳管 |
| 内部目录 | 任意层级的 .git、.local、.cache、.work、.pakku、node_modules 不作为游戏内容分发 |
| 账户与凭据 | 任意层级的 .env / .env.*、accounts.json、launcher_accounts.json、credentials / credentials.json 拒绝；文本中的非空访问令牌、API 密钥字段和 PEM 私钥拒绝，空字段及公开证书允许 |
| 启动器和运行记录 | 根目录 launcher_profiles.json、launcher_settings.json、hmclversion.cfg、hmcl.json、modpack.cfg、usercache.json、usernamecache.json、session.lock 拒绝；实例实际版本 JSON/JAR 在同步和恢复时按路径保护 |
| 路径与文件系统 | 拒绝越界、绝对路径、Windows 保留名、大小写输出冲突、符号链接和 junction；Runtime 文件还需是非硬链接的普通文件 |
| 未声明的源归档 | 散落 JAR/ZIP/MRPACK 不作为正式源；需放入 overrides 或通过明确的 Pakku overrides 规则声明 |

Git 默认收录标准 overrides 中的作者内容，但仍忽略上述私人/内部路径。自定义 overrides 源目录如被全局忽略规则命中，需添加精确的 Git 例外。Git 忽略不是安全校验的替代品；凭据检测也不是完整的敏感信息扫描。

下述为工具能力说明；本项目当前只维护 YoSBR 默认值，不分发根 options。

**默认设置的开发流程**：把筛选后的设置写入 `.pakku/client-overrides/options.txt`，检查并构建，再同步。实例中已有不同内容时报告冲突，不自动覆盖；只有完全相同的文件可经明确确认接管。首次成功同步后，游戏修改这些设置会在 Changes 中显示；可确认 Collect 回收文本，或人工协调后继续同步。模板不会把未声明的玩家 options 自动发现为新候选。

**回收范围**：已映射的公共/客户端文本均可审查回收，包括根目录设置和脚本；新文件仍只从 config 自动发现，且必须明确选择来源。Collect 仍限制为不超过 256 KiB 的 UTF-8 文本，不回收 JAR/ZIP/MRPACK，不自动回收二进制；大型文本或二进制资源由作者直接更新项目。删除需额外确认，双方同时修改保持冲突保护。

**格式与工具边界**：MRPACK 创建工程目前只支持格式 1、单个已知 Loader 和 Modrinth 目标；索引依赖必须由 Pakku 唯一识别并保持哈希、路径、大小和侧别，optional 侧别、未知字段、重复项目或无法转换的索引项会阻止注册。内嵌 overrides 原样保留并核对导出。override 声明不支持 glob，归档大小/ZIP64/加密限制见上文；索引下载要求无凭据 HTTPS 和可信哈希。

**写入边界**：只写明确绑定且版本匹配的隔离实例；不支持共享游戏目录。所有写入仍要求游戏停止，保留冲突检查、备份、日志和恢复；失败不提前更新成功基线。Apply 需要本次包哈希确认，远端来源继续校验报告与提交身份。未知文件不会被清理，脚本和游戏不会被自动启动。

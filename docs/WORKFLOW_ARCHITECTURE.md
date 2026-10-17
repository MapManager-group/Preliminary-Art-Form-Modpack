# 架构说明

## 工具分工

| 工具 | 职责 |
| --- | --- |
| `ci.ps1` | Windows 中文菜单、快捷命令、用户确认，调用标准 CLI |
| Pakku | 管理 Mod 依赖和锁文件，导出整合包 |
| Workspace CLI（`mp`） | 选择目标、检查源文件、组织构建、同步测试实例 |
| PCL2 / HMCL | 安装和启动 Minecraft、加载器，管理账户与游戏环境 |
| Git | 保存包配置、依赖锁文件、正式资源和工具代码 |
| GitHub Actions | 检查提交、构建预览包、创建发布草稿 |

每个目标都是标准 Pakku 工程。CLI 调用 Pakku，不重复实现依赖解析，也不保存第二份 Mod 清单。

入口关系为 `ci.ps1 → pnpm run mp -- … → tools/mp.mjs`。菜单读取现有目标、绑定和状态；Target 选择通过 `mp use` 保存，Runtime 选择保留在菜单会话中。部署、回收、备份和构建仍由 Node 核心模块执行。

创建工程由 `create-target` 负责：空白工程确认后调用原生 `init`；MRPACK 经原生 `import` 识别依赖、转换覆盖目录，再导出对照验证。候选在 `.work/`，确认后检查源文件并注册到工作区；此流程不涉及 Runtime。实现位于 `tools/lib/create-project.mjs`，不另建依赖清单。

## 操作反馈

Node 核心在真实阶段边界发送进度；PowerShell 只负责消费事件、显示摘要、保存详情。菜单为子命令临时设置 `MP_PROGRESS=jsonl`，结束后恢复原值。默认 CLI 和 CI 不启用事件。

启用时 stderr 每行以 `@mp:` 开头，后接 JSON：

```json
{"schema":1,"type":"progress","stage":"build.verify","message":"正在校验构建产物"}
```

`diagnostic` 事件的 `text` 保存捕获到的 Pakku 原始输出，仅在详情中展示。换行由 JSON 转义。stdout 的最终结果、普通 stderr 错误和退出码保持原样；无效或未知事件作为普通日志保留。事件不写入源工程、部署记录或候选 Lock。

## 目录组织

```text
├── ci.ps1               # 本地交互菜单与快捷命令
├── workspace.json       # 目标名称、路径、需要收集的包类型
├── toolchain.json       # 工具版本、下载地址和校验值
├── packs/
│   └── <目标名>/
│       ├── pakku.json
│       ├── pakku-lock.json
│       ├── config/
│       └── .pakku/
│           ├── overrides/
│           ├── client-overrides/
│           └── server-overrides/
├── tools/               # CLI 与构建、同步工具
├── tests/               # 自动化测试
├── docs/                # 使用与维护说明
└── .github/workflows/   # CI 与发布流程
```

Minecraft、加载器和 Mod 版本保存在 Pakku 工程中，`workspace.json` 只组织目标。客户端与服务端共用依赖时，通过 Pakku 的侧别和覆盖文件规则分别打包；需要独立维护时再拆成不同目标。

本机数据与源文件分开：`.local/` 保存选择、实例绑定和备份；`.cache/` 保存工具及下载文件；`.work/` 保存构建副本；`dist/` 保存输出。这些目录均由 Git 忽略。`.pakku/` 中的正式覆盖资源需要提交，Pakku 的 build、shelf、remote、docs 等生成数据不提交。

## 从源工程到游戏实例

目标（Target）是一套包配置与依赖；实例（Runtime）是启动器中已安装的游戏目录；构建产物是可分发的整合包文件。一个目标可以绑定多个测试实例。

```text
Pakku 源工程 ── build ──> 整合包 / CI 预览包
     │                         │
   deploy                    apply
     │                         │
     └──────> 测试实例 <────────┘
                 │
          changes / collect
                 │
                 └──────> 源工程
```

部署依据 Pakku 导出的客户端文件清单，只更新变化的文件。删除仅针对以前部署过且现在不再需要的文件；存档、账户、日志和未知文件保留。写入前保存备份，失败后用 `recover` 恢复。

配置回收比较上次部署、当前源文件和实例文件。只有实例改变时可以取回；两边发生不同修改时先合并。Mod 的增删仍交给 Pakku，实例中的 JAR 不复制回源工程。

本地构建和 CI 使用同一构建逻辑，在副本中导出并检查包内容。Apply 校验整合包、来源报告和哈希后，使用同一部署逻辑更新实例。发布流程创建 GitHub 草稿，由维护者检查后公开。

## 使用范围

实例同步和 Apply 面向客户端 MRPACK。安装游戏、选择可选 Mod、启动游戏及验证玩法仍由启动器和使用者完成。CI 默认构建 Modrinth 目标；其他平台需要另行配置凭据和发布流程。

具体操作见[开发指南](DEVELOPMENT.md)、[启动器同步](LAUNCHER_SYNC.md)和[构建与发布](RELEASE.md)。

# Preliminary Art Form

[English](README_en.md)

> "preliminary art form" is about the trance you have when working on a thing for so long that it becomes second nature.
>
> -- C418, One.

一个简单且全面的建筑专用整合包，包含了所有你需要的建筑创作工具和辅助功能。

**Preliminary Art Form** 起初是为 **LorianStudio** 的建筑社区服务器设计的定制客户端，因此有内部开发别名 **LorianDesign**，后续计划发展为支持多版本的原版 Minecraft 全能建筑设计整合包。

---

本仓库为 **Preliminary Art Form** 的项目开发仓库，使用 [Pakku](https://github.com/juraj-hrivnak/Pakku) 管理依赖，采用 pnpm + JavaScript ESM 工作流，仅交付 Modrinth `.mrpack`。

## 当前开发版本（WIP）

| Minecraft | Loader | Pack version | Target |
| --- | --- | --- | --- |
| 26.2 | Fabric 0.19.5 | A1.3.1 | `client-26.2` |

当前仅有客户端工程 `packs/client-26.2`，没有服务端发布目标。包版本来自 `pakku.json`，Minecraft、Loader 和托管依赖版本来自 `pakku-lock.json`。

## 项目结构

```text
├─ packs/client-26.2/       # 可独立使用 Pakku 的正式工程
│  ├─ pakku.json           # 包信息、侧别及导出配置
│  ├─ pakku-lock.json      # Pakku 生成的精确依赖锁
│  └─ .pakku/client-overrides/ # 默认配置、自有 Mod、语言包和资源
├─ workspace.json          # Target 路径与构建类型
├─ toolchain.json          # 固定工具版本和 Pakku SHA-256
├─ ci.ps1                  # PowerShell 菜单和快捷入口
├─ tools/                  # 管理、构建、同步和发布工具
├─ tests/                  # 使用临时实例的自动化测试
├─ docs/                   # 项目文档与迁移记录
└─ .github/workflows/      # CI 预览包及发布草稿
```

## 快速开始

准备 Git、Node.js 24、pnpm 10.28.2、Java 21；本地菜单使用 PowerShell 7.3+。Java 21 用于运行 Pakku，游戏运行环境由启动器按 Minecraft 版本安装。

```powershell
pnpm install --frozen-lockfile
pnpm run mp -- bootstrap
pnpm run mp -- doctor
pnpm run mp -- check --all
pnpm run mp -- build --target client-26.2
.\ci.ps1
```

日常也可使用 `pnpm run mp -- list --target client-26.2`，或 `.\ci.ps1 build -Target client-26.2`。完整命令见 `pnpm run mp -- help`。

产物位于 `dist/client-26.2/build-*/`，包含 `.mrpack`、`SHA256SUMS` 和 `build-report.json`。CI 根据受影响目标运行检查和构建；首次分支推送与手动运行覆盖全部目标。发布标签只创建 GitHub 草稿，不自动公开或上传 Modrinth。

默认设置由 YoSBR 提供；不分发旧的根目录 `options.txt`。托管依赖通过 Pakku 维护；Lorian’s Arch Orbit、自有菜单 Mod、iterationT 及原有内嵌资源由正式 overrides 保存，更新需要人工核验来源与哈希。

## 提交规范

使用 **Gitmoji + Conventional Commits**，例如 `✨ feat(mod): 新增建筑辅助功能`。允许中文和自定义 scope，标题不超过 72 字符。先检查并暂存本次修改，再执行：

```powershell
pnpm run commit
pnpm run lint:commits
```

默认校验最新一条提交，支持首次提交；尚无提交时会明确提示未执行。检查指定区间可用 `pnpm run lint:commits -- --from <base> --to HEAD`。

## 项目文档

- [开发指南](docs/DEVELOPMENT.md)
- [Modrinth 打包说明](docs/PACKAGING.md)
- [启动器同步](docs/LAUNCHER_SYNC.md)
- [构建与发布](docs/RELEASE.md)
- [架构说明](docs/WORKFLOW_ARCHITECTURE.md)
- [Minecraft 26.2 迁移记录](docs/MIGRATION-26.2.md)
- [Pakku v2 迁移记录与模板反馈](docs/MIGRATION-V2.md)
- [更新日志](docs/CHANGELOG.md)
- [贡献指南](CONTRIBUTING.md)

## 许可证与架构来源

项目保留 [MIT 许可证](LICENSE)。开发架构基于 [DB-Modpack-Dev-Workflow](https://github.com/DavidBlackCN/DB-Modpack-Dev-Workflow) 的 v2 模板（CC0-1.0）；具体基线见迁移记录。第三方 Mod、工具及素材遵循各自许可证。

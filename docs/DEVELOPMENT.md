# 开发说明

本仓库使用 packwiz 管理 Fabric 整合包，只导出 Modrinth `.mrpack`。

## 环境要求

- Git、Node.js（含 npm）
- **PowerShell 7+ (pwsh)**，Windows 下可通过 `winget install Microsoft.PowerShell` 安装
- 仓库根目录中的 `packwiz.exe`

```powershell
npm install
git status --short
```

外部依赖应提交 `.pw.toml`。无公共下载源的自有 JAR 只有在 `packwiz/local-files.json` 中记录精确 SHA-256、原因和许可证后才允许提交；不要提交其他 JAR、构建产物、缓存、日志、存档、账号或启动器私有配置。

## 日常操作

**所有日常操作都通过 `pack.ps1` 完成。** 它自动处理实例/版本探测、缓存路径、索引刷新和提交建议。

```powershell
.\scripts\pack.ps1                                          # 交互菜单（推荐）
.\scripts\pack.ps1 add sodium                               # 从 Modrinth 添加 Mod
.\scripts\pack.ps1 add -Source curseforge jade               # 从 CurseForge 添加 Mod
.\scripts\pack.ps1 add -Folder shaderpacks complementary-reimagined
.\scripts\pack.ps1 add -Folder resourcepacks xaeros-minimap
.\scripts\pack.ps1 remove sodium                            # 移除依赖
.\scripts\pack.ps1 update                                   # 更新全部依赖
.\scripts\pack.ps1 update sodium                            # 更新单个依赖
.\scripts\pack.ps1 update -UpdateChannel prerelease --all   # 更新到最新版（包含 alpha/beta）
.\scripts\pack.ps1 pin                                      # 固定版本（交互式）
.\scripts\pack.ps1 unpin                                    # 解除固定（交互式）
.\scripts\pack.ps1 list                                     # 列出当前依赖
.\scripts\pack.ps1 refresh                                  # 刷新 index.toml
.\scripts\pack.ps1 validate                                 # 校验整合包
.\scripts\pack.ps1 build                                    # 导出 .mrpack → dist/
.\scripts\pack.ps1 -- <任意 packwiz 参数>                    # 透传给 packwiz
.\scripts\pack.ps1 help                                     # 查看帮助
```

`add / remove / update / pin / unpin / refresh / build` 完成时会自动校验整合包，并提示建议的 commit 信息。`add` 默认使用 Modrinth，也可用 `-Source curseforge` 或在交互菜单选择 CurseForge；CurseForge 依赖导出 `.mrpack` 时会内嵌 JAR，提交前需确认再分发许可。交互菜单中的每项操作完成后可输入 `r` 继续同类操作、直接按 Enter 返回主菜单，或输入 `0` 退出；移除依赖前还会要求确认，便于连续清理依赖时避免误删。若校验发现运行时或敏感文件，本地 CLI 会列出路径并要求确认后才清理；CI 和直接运行校验脚本会严格失败，不会自动删除。菜单中的“指定/回退 Modrinth 版本”可替换已有依赖为粘贴的 Modrinth 版本页面链接；替换失败时会恢复原始元数据。

`update` 默认使用 `release` 渠道：只更新到与当前 Minecraft 版本和加载器兼容的最新正式版，并尊重已固定的依赖。Modrinth 通过官方 API 精确选择版本；CurseForge 通过 CFWidget 的公开 JSON 数据选择 release 文件，再在临时整合包副本中预跑 packwiz，只有 packwiz 候选文件 ID 与该 release 一致时才更新真实元数据。若数据源不可用或 packwiz 候选是 alpha/beta，则安全跳过并显示提示。交互菜单会在选择更新范围前询问渠道；命令行可使用 `-UpdateChannel prerelease` 显式允许 alpha/beta。

### 实例与版本指定

`packwiz/instances.json` 是实例、Minecraft 版本、工程路径和 artifact 名称的唯一数据源。无参数打开交互菜单时会显示所有登记目标；命令行调用使用 `-Instance` 与 `-Version` 明确指定。当前只有 `client/26.2`，`server/` 只是空预留目录：

```powershell
.\scripts\pack.ps1 add sodium -Instance client -Version 26.2
```

创建新实例/版本使用 `scripts/new-pack.ps1`；也可通过 `-ImportMrpack` 导入现有 Modrinth 包。导入后必须检查 `import-reports/`，不得忽略未解析的嵌入依赖。

## 校验与构建

```powershell
.\scripts\pack.ps1 validate                     # refresh + 敏感文件检查 + 元数据比对
.\scripts\pack.ps1 build                        # 导出 Modrinth .mrpack
```

## 使用 cz-git 提交

项目使用 Commitizen 和 `cz-git` 生成提交信息，配置位于仓库根目录的 `cz.config.js`。先暂存本次要提交的原子化改动，再运行：

```powershell
git status --short
git diff
git add <本次修改的文件>
npm run commit
```

也可在 VS Code 的“运行任务”中选择 **Git Commit CZ**。该任务不会自动暂存文件，方便你在提交前确认范围。

按提示依次选择提交类型、可选 scope 和说明。模板已启用 Gitmoji，允许自定义 scope，标题长度上限为 72 个字符；仅 `feat` 和 `fix` 可标记为破坏性更新。

常用 scope：`packwiz`、`mod`、`resource`、`config`、`mrpack`、`fabric`、`ci`、`github`、`docs`。

提交信息和 `docs/CHANGELOG.md` 遵循 Gitmoji + Conventional Commits，例如：

```text
✨ feat(packwiz): add a building utility mod
🐛 fix(config): correct the default key binding
📝 docs(development): document the pack CLI workflow
```

### CI 说明

GitHub Actions（`.github/workflows/validate.yml`）在 push、Pull Request 或手动触发时运行：

1. **commitlint**：检查 Gitmoji + Conventional Commits 提交格式
2. **pack-changes**：检测 `packwiz/**`、`scripts/**`、`.github/workflows/validate.yml` 与 `.gitattributes` 是否发生变化
3. **discover**：仅在关键路径变化或手动触发时校验 `packwiz/instances.json` 并生成动态 matrix
4. **validate-and-build（matrix × 实例/版本）**：使用固定提交和上游指定的 Go 版本构建 packwiz，再逐个目标执行校验 → 索引一致性检查 → 构建 `.mrpack` → 上传独立 artifact

仅修改文档或其他非关键路径时，commitlint 仍会运行，但打包作业会跳过；`workflow_dispatch` 始终构建全部目标。

**新增目标只需更新 `instances.json`，无需修改 CI。**

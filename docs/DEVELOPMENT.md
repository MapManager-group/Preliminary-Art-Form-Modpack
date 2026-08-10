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

不要提交 JAR、构建产物、缓存、日志、存档、账号或启动器私有配置。

## 日常操作

**所有操作都通过 `pack.ps1` 完成。** 它自动处理版本探测、缓存路径、索引刷新和提交建议。

```powershell
.\scripts\pack.ps1                                          # 交互菜单（推荐）
.\scripts\pack.ps1 add sodium                               # 从 Modrinth 添加 Mod
.\scripts\pack.ps1 add -Folder shaderpacks complementary-reimagined
.\scripts\pack.ps1 add -Folder resourcepacks xaeros-minimap
.\scripts\pack.ps1 remove sodium                            # 移除依赖
.\scripts\pack.ps1 update                                   # 更新全部依赖
.\scripts\pack.ps1 update sodium                            # 更新单个依赖
.\scripts\pack.ps1 pin                                      # 固定版本（交互式）
.\scripts\pack.ps1 unpin                                    # 解除固定（交互式）
.\scripts\pack.ps1 list                                     # 列出当前依赖
.\scripts\pack.ps1 refresh                                  # 刷新 index.toml
.\scripts\pack.ps1 validate                                 # 校验整合包
.\scripts\pack.ps1 build                                    # 导出 .mrpack → dist/
.\scripts\pack.ps1 -- <任意 packwiz 参数>                    # 透传给 packwiz
.\scripts\pack.ps1 help                                     # 查看帮助
```

`add / remove / update / pin / unpin` 完成后自动刷新索引，并提示建议的 commit 信息。交互菜单中的每项操作完成后可输入 `r` 继续同类操作、直接按 Enter 返回主菜单，或输入 `0` 退出；移除依赖前还会要求确认，便于连续清理依赖时避免误删。

### 版本指定

单个版本目录时自动探测。无参数打开交互菜单且存在多个版本目录时，脚本会先显示版本列表供选择，`packwiz/versions.json` 的 `default` 字段会标为默认选项。命令行调用可通过 `-Version` 参数明确指定；未指定时使用有效的 `default` 值：

```powershell
.\scripts\pack.ps1 -Version 1.21 add sodium
```

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

提交信息和 `docs/CHANGELOG.md` 使用英文，并遵循 Gitmoji + Conventional Commits，例如：

```text
✨ feat(packwiz): add a building utility mod
🐛 fix(config): correct the default key binding
📝 docs(development): document the pack CLI workflow
```

### CI 说明

GitHub Actions（`.github/workflows/validate.yml`）在 `packwiz/**` 或 `scripts/**` 变动时自动运行：

1. **discover**：扫描 `packwiz/` 下所有含 `pack.toml` 的版本目录
2. **validate-and-build（matrix × 版本）**：逐个版本执行校验 → 索引一致性检查 → 构建 `.mrpack` → 压缩为独立 ZIP → 按 Minecraft 版本上传 artifact

**新增版本目录无需修改 CI。**

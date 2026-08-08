# 开发说明

本仓库使用 packwiz 管理 Fabric 整合包，并且只导出 Modrinth `.mrpack`。以下所有命令均在**仓库根目录**的 PowerShell 中执行。

当前整合包目录为 `packwiz/26.2`。如需操作其他 Minecraft 版本，将命令中的 `26.2` 替换为对应目录名。

## 准备环境

需要 Git、Node.js（含 npm）和仓库根目录中的 `packwiz.exe`。

```powershell
npm install
git status --short
```

不要提交 JAR、构建产物、缓存、日志、存档、账号或启动器私有配置。

## 日常操作

修改配置、本地资源或 `.pw.toml` 元数据后，刷新索引：

```powershell
.\scripts\refresh.ps1 -MinecraftVersion 26.2
```

提交前校验整合包：

```powershell
.\scripts\validate.ps1 -MinecraftVersion 26.2
```

导出 Modrinth `.mrpack`：

```powershell
.\scripts\build.ps1 -MinecraftVersion 26.2
```

构建结果位于 `dist/`，不应提交到 Git。

## 管理外部依赖

外部 Mod、资源包和光影包应提交其 `.pw.toml` 元数据，而非下载得到的 JAR 或 ZIP。下面的命令均从根目录执行，并将缓存保存在 `.packwiz-cache/`。

查看当前依赖：

```powershell
.\packwiz.exe --cache .\.packwiz-cache --pack-file .\packwiz\26.2\pack.toml list
```

从 Modrinth 添加 Mod（也可将 `sodium` 换成项目链接）：

```powershell
.\packwiz.exe --cache .\.packwiz-cache --pack-file .\packwiz\26.2\pack.toml --meta-folder mods --meta-folder-base .\packwiz\26.2 modrinth add sodium
.\scripts\refresh.ps1 -MinecraftVersion 26.2
```

更新单个依赖或全部依赖：

```powershell
.\packwiz.exe --cache .\.packwiz-cache --pack-file .\packwiz\26.2\pack.toml update sodium
.\packwiz.exe --cache .\.packwiz-cache --pack-file .\packwiz\26.2\pack.toml update --all
.\scripts\refresh.ps1 -MinecraftVersion 26.2
```

`update --all` 可能引入不兼容更新；执行后请检查差异并进行实际启动测试。移除、固定或解除固定依赖时，运行下列交互式命令，完成后刷新索引：

```powershell
.\packwiz.exe --cache .\.packwiz-cache --pack-file .\packwiz\26.2\pack.toml remove
.\packwiz.exe --cache .\.packwiz-cache --pack-file .\packwiz\26.2\pack.toml pin
.\packwiz.exe --cache .\.packwiz-cache --pack-file .\packwiz\26.2\pack.toml unpin
.\scripts\refresh.ps1 -MinecraftVersion 26.2
```

添加或修改 `packwiz/26.2/config/`、`resourcepacks/`、`shaderpacks/`、`options.txt` 等本地文件后，同样运行 `refresh.ps1`。需要排除出整合包的文件写入对应版本目录的 `.packwizignore`。

## 使用 cz-git 提交

项目使用 Commitizen 和 `cz-git` 生成提交信息，配置位于仓库根目录的 `cz.config.js`。

确保已执行 `npm install` 后，运行：

```powershell
npm run commit
```

按提示依次选择提交类型、可选 scope 和说明。模板已启用 Gitmoji，允许自定义 scope，标题长度上限为 72 个字符；仅 `feat` 和 `fix` 可标记为破坏性更新。

常用 scope：`packwiz`、`mod`、`resource`、`config`、`mrpack`、`fabric`、`ci`、`github`、`docs`。

提交信息和 `docs/CHANGELOG.md` 遵循 Gitmoji + Conventional Commits，例如：

```text
✨ feat(packwiz): add a building utility mod
🐛 fix(config): correct the default key binding
```

提交前请检查改动范围，保持每次提交原子化：

```powershell
git status --short
git diff
git add <本次修改的文件>
npm run commit
```

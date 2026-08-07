# 开发指南

本仓库使用 [packwiz](https://packwiz.infra.link/) 管理多版本 Fabric 整合包，只构建 Modrinth `.mrpack`。`packwiz/` 下的每个子目录都是一个相互独立的 Minecraft 版本项目，例如：

```text
packwiz/
├─ 26.2/
│  ├─ pack.toml
│  ├─ index.toml
│  ├─ mods/
│  ├─ resourcepacks/
│  ├─ shaderpacks/
│  └─ config/
└─ 26.3/
   └─ ...
```

不同版本不得共用 `pack.toml` 或 `index.toml`。以下命令默认在仓库根目录使用 PowerShell 运行。

## 1. 开发环境

开发前请确认：

- 根目录存在 `packwiz.exe`；该文件只在本地使用，不提交 Git。
- 当前工作区没有需要保留但尚未记录的无关修改。
- 新增或更新的模组、资源包、光影包具有可用的下载源和合适的分发许可。

常用检查命令：

```powershell
git status --short
.\scripts\validate.ps1 -MinecraftVersion 26.2
```

仓库脚本会把 packwiz 缓存放到根目录的 `.packwiz-cache/`，该目录已被 Git 忽略。

## 2. 版本分支（目录）约定

本文所说的“版本分支”专指 `packwiz/` 下按 Minecraft 版本划分的目录，不是 Git 分支。所有版本分支同时保存在同一个仓库中。

### 2.1 目录命名

版本分支目录应直接使用对应的 Minecraft 版本号：

```text
packwiz/26.2/
packwiz/26.3/
packwiz/1.21.11/
```

同一 Minecraft 版本的 A1.0、A1.1 等整合包迭代继续使用同一个目录，其版本号写入该目录的 `pack.toml`，不为每个整合包版本重复创建目录。

### 2.2 分支独立性

每个版本分支必须独立保存：

- `pack.toml`：整合包名称、版本、Minecraft 和加载器版本。
- `index.toml`：该版本全部内部文件和外部元数据的索引。
- `mods/`、`resourcepacks/`、`shaderpacks/`：该版本的外部依赖元数据和允许内置的资源。
- `config/`、`options.txt`、`servers.dat`：该版本实际使用的默认配置。
- `.packwizignore`：该版本不应进入最终整合包的文件规则。

不同版本分支之间可以参考或复制文件，但之后必须分别刷新、验证和构建。修改 `packwiz/26.2/` 不会自动同步到 `packwiz/26.3/`。

## 3. 新建 Minecraft 版本

新增版本有两种方式。跨越较大、兼容性不确定时推荐全新初始化；仅小版本升级且大部分依赖兼容时可以从旧版本迁移。

### 3.1 方式一：全新初始化

先创建空目录，再运行 packwiz 初始化：

```powershell
New-Item -ItemType Directory -Path .\packwiz\26.3
Set-Location .\packwiz\26.3

..\..\packwiz.exe init `
  --name "Preliminary Art Form" `
  --author "LorianStudio" `
  --version "26.3-A1.0" `
  --mc-version "26.3" `
  --modloader "fabric" `
  --fabric-version "<目标 Fabric Loader 版本>"

Set-Location ..\..
```

随后从旧版本逐项迁移仍然兼容的 `.pw.toml` 和配置。不要直接假设旧模组、旧配置或客户端/服务端属性在新版本仍然有效。

至少需要检查并更新：

1. `packwiz/26.3/pack.toml` 中的整合包版本、Minecraft 和 Fabric Loader 版本。
2. 每个模组是否有目标 Minecraft 版本的 Fabric 构建。
3. 每个 `.pw.toml` 的 `side` 是否仍为 `client`、`server` 或 `both`。
4. 配置文件是否改名、废弃或新增字段。
5. 根目录 `README.md` 与 `README_en.md` 的版本表。
6. `.github/workflows/validate.yml` 中需要验证和构建的版本。
7. `CHANGELOG.md` 中对应版本的英文更新记录。

### 3.2 方式二：从旧版本迁移

确认目标目录不存在后，复制一个已验证的旧版本项目：

```powershell
Copy-Item -Recurse .\packwiz\26.2 .\packwiz\26.3
Set-Location .\packwiz\26.3
```

迁移 Minecraft 和 Fabric Loader：

```powershell
..\..\packwiz.exe migrate minecraft 26.3
..\..\packwiz.exe migrate loader recommended
```

也可以把 `recommended` 替换为明确的 Fabric Loader 版本。之后更新 `pack.toml` 中的整合包 `version`，例如 `26.3-A1.0`，并逐项更新外部依赖：

```powershell
..\..\packwiz.exe update --all
..\..\packwiz.exe refresh
Set-Location ..\..
```

`update --all` 可能引入不兼容更新，不能在未审查差异和未进行启动测试的情况下直接提交。无法更新到目标版本的项目应被替换或移除。

## 4. 添加外部依赖

外部依赖包括模组、资源包和光影包。仓库通常只提交 `.pw.toml` 元数据，不提交下载后的 JAR 或 ZIP。

### 4.1 从 Modrinth 添加项目

进入目标版本目录后，可以使用项目 slug、项目链接或具体版本链接：

```powershell
Set-Location .\packwiz\26.2

..\..\packwiz.exe modrinth add sodium
..\..\packwiz.exe modrinth add https://modrinth.com/mod/sodium
..\..\packwiz.exe modrinth add https://modrinth.com/mod/sodium/version/<version-id>

Set-Location ..\..
```

需要锁定精确项目和版本时使用：

```powershell
Set-Location .\packwiz\26.2

..\..\packwiz.exe modrinth add `
  --project-id "<project-id>" `
  --version-id "<version-id>" `
  --version-filename "<filename>"

Set-Location ..\..
```

packwiz 会根据 Modrinth 项目类型把元数据放入 `mods/`、`resourcepacks/` 或 `shaderpacks/`，并处理已声明的依赖。完成后应检查生成文件中的：

```toml
filename = "example.jar"
side = "client"

[update.modrinth]
mod-id = "..."
version = "..."
```

客户端界面、光影和纯客户端优化通常使用 `side = "client"`；服务端专用项目使用 `server`；两端都需要的项目使用 `both`。不要仅凭名称猜测，优先参考项目页面和实际运行要求。

### 4.2 添加直链资源

只有在项目没有可用的 Modrinth 元数据时才使用直接下载链接。例如把文件元数据放入 `resourcepacks/`：

```powershell
Set-Location .\packwiz\26.2

..\..\packwiz.exe url add "Example Resource Pack" "https://example.com/example.zip" `
  --meta-folder resourcepacks `
  --meta-name example-resource-pack.pw.toml

Set-Location ..\..
```

直链必须稳定且允许分发。Modrinth 导出时，缺少 Modrinth 更新元数据的文件可能被内嵌到 `.mrpack`，因此发布前必须确认许可证。创建后检查下载 URL、文件名、哈希和 `side`。

## 5. 更新、固定和移除依赖

### 5.1 查看当前依赖

```powershell
Set-Location .\packwiz\26.2
..\..\packwiz.exe list -v
Set-Location ..\..
```

### 5.2 更新单个依赖

优先单项更新，便于审查影响：

```powershell
Set-Location .\packwiz\26.2
..\..\packwiz.exe update sodium
..\..\packwiz.exe refresh
Set-Location ..\..
```

如果必须更新到指定版本，使用该版本的 Modrinth 链接重新执行 `modrinth add`，并确认生成的 `.pw.toml` 覆盖了原项目而没有产生重复项。

更新后检查：

- `.pw.toml` 中的版本 ID、文件名、下载地址和哈希。
- 是否新增或移除了依赖。
- `side` 是否发生变化。
- 配置格式是否需要同步升级。
- `index.toml` 是否已刷新。

### 5.3 批量更新

```powershell
Set-Location .\packwiz\26.2
..\..\packwiz.exe update --all
..\..\packwiz.exe refresh
Set-Location ..\..
```

批量更新应作为一次独立变更执行。更新前后使用 `git status` 和 `git diff` 逐项核对，不要把所有自动更新结果视为天然兼容。

### 5.4 固定或解除固定版本

`pin` 和 `unpin` 会打开交互式项目选择：

```powershell
Set-Location .\packwiz\26.2
..\..\packwiz.exe pin
..\..\packwiz.exe unpin
Set-Location ..\..
```

固定适用于已知新版本存在兼容问题、必须暂时停留在特定版本的项目。应在英文 `CHANGELOG.md` 或相关开发记录中说明原因。

### 5.5 移除依赖

运行交互式移除命令：

```powershell
Set-Location .\packwiz\26.2
..\..\packwiz.exe remove
..\..\packwiz.exe refresh
Set-Location ..\..
```

也可以删除对应 `.pw.toml` 后运行 `refresh`。移除项目时同时检查仅由它使用的依赖和配置，但不要在没有确认用途时顺带删除共享依赖。

## 6. 添加或修改本地文件

packwiz 会把版本目录内未被 `.packwizignore` 排除的普通文件作为内部文件，按相同相对路径安装到 Minecraft 实例。

常见路径：

| 仓库路径 | 安装位置/用途 |
| --- | --- |
| `packwiz/26.2/config/` | 模组配置 |
| `packwiz/26.2/resourcepacks/` | 自有或允许内置的资源包 |
| `packwiz/26.2/shaderpacks/` | 自有或允许内置的光影包 |
| `packwiz/26.2/options.txt` | 默认游戏选项 |
| `packwiz/26.2/servers.dat` | 预设服务器列表 |

例如添加本地语言资源：

```powershell
New-Item -ItemType Directory -Force `
  .\packwiz\26.2\resourcepacks\Lorian-Language-CN

Copy-Item -Recurse `
  .\path\to\language-pack\* `
  .\packwiz\26.2\resourcepacks\Lorian-Language-CN

.\scripts\refresh.ps1 -MinecraftVersion 26.2
```

修改已有配置后同样需要刷新：

```powershell
.\scripts\refresh.ps1 -MinecraftVersion 26.2
```

注意事项：

- 只有项目自有文件或明确允许整合包再分发的文件才可以直接纳入。
- 不要提交账号、令牌、日志、缓存、存档、启动器状态或服务器私有数据。
- Axiom `blueprints/` 当前明确排除，等待人工迁移。
- 本地专有 JAR 默认不得直接提交。应先发布到稳定、授权的下载位置，再建立 `.pw.toml` 直链元数据。
- 只供开发者使用、不应进入游戏实例的文件应加入该版本的 `.packwizignore`。

`.packwizignore` 使用与 `.gitignore` 类似的规则。例如：

```gitignore
/.packwizignore
/*.mrpack
**/accounts.json
**/blob_cache/
**/blueprints/
*.log
*.bak
*.backup
```

`.gitignore` 决定文件是否提交仓库；`.packwizignore` 决定文件是否进入 packwiz 索引和最终整合包。二者用途不同，必要时需要同时配置。

## 7. 刷新、验证和构建

手动增删或修改版本目录中的任何内部文件后，必须刷新索引：

```powershell
.\scripts\refresh.ps1 -MinecraftVersion 26.2
```

提交前执行完整验证：

```powershell
.\scripts\validate.ps1 -MinecraftVersion 26.2
```

生成 Modrinth 包：

```powershell
.\scripts\build.ps1 -MinecraftVersion 26.2
```

构建产物位于 `dist/`，不会提交 Git。验证至少应包含：

1. packwiz 能刷新并读取全部元数据。
2. `index.toml` 在重复刷新后保持稳定。
3. 外部依赖数量符合预期，没有重复项目。
4. 包内不存在账号、缓存、日志和暂缓迁移的 Axiom 蓝图库。
5. 使用目标启动器实际导入 `.mrpack` 并完成一次启动测试。

## 8. 更新日志与提交

项目文档默认使用中文，只有 `README_en.md` 使用英文。`CHANGELOG.md` 和 Git 提交信息是例外：二者必须使用英文，并同时遵循 **Gitmoji + Conventional Commits**。

更新日志示例：

```markdown
- ✨ feat(pack): add a building utility mod
- ⬆️ build(deps): update Sodium to 0.9.2
- 🐛 fix(config): correct the default key binding
```

提交示例：

```powershell
git status --short
git diff
git add <本次修改的文件>
git commit -m "✨ feat(pack): add a building utility mod"
```

每个提交应保持原子化，不夹带无关修改。提交前确认 `pack.toml`、`index.toml`、相关 `.pw.toml`、配置和英文 `CHANGELOG.md` 已同步更新。

# 构建与发布

## GitHub Actions

本项目提供两个工作流：

| 工作流 | 触发方式 | 结果 |
| --- | --- | --- |
| `ci.yml` | PR、任意分支推送、手动运行 | 检查与预览包 |
| `release.yml` | 推送 `release/<目标名>/v<版本>` 标签 | GitHub 发布草稿 |

创建自己的仓库后，在 Actions 中启用工作流。分支规则包含带 `/` 的名称，不需要按默认分支修改；标签推送由发布工作流处理。分支保护可将 **Required checks** 设为必需检查。

同仓库同分支的 Push 和 PR 共用并发组，新运行取消尚未完成的旧运行；两次运行先后完成时仍可能各自执行，模板不额外调用 API 去重。Fork PR 使用来源仓库区分并发组。

CI 根据变更文件选择任务，提交信息检查始终执行：

| 变更范围 | Windows / Linux 测试与源检查 | 预览包构建 |
| --- | --- | --- |
| 根目录文档、`docs/`、`.vscode/`、Issue 模板 | 跳过 | 跳过 |
| `ci.ps1`、`tests/`、验证脚本、提交规范配置 | 执行 | 跳过 |
| `packs/<目标>/` 中的源文件 | 执行 | 仅对应目标 |
| `tools/lib/`、`tools/mp.mjs`、`tools/ci.mjs`、`tools/release.mjs` | 执行 | 全部目标 |
| 工作区、工具链、依赖配置及锁文件、`.npmrc`、Git 忽略与属性规则、CI / Release 工作流 | 执行 | 全部目标 |

筛选规则集中在 `tools/ci.mjs`；新增构建入口或公共输入时同步更新规则。包源中的 Markdown 也可能是分发资源，会触发对应构建。手动运行执行全部检查与构建。`Required checks` 接受按计划跳过的任务，但不接受应执行任务的失败或取消。保留工作流入口而在任务层筛选，可避免必需检查因路径过滤一直等待。

首次分支推送构建全部目标；后续 Push 比较前后提交，PR 比较与目标分支共同祖先之后的改动。检查结束后确认已跟踪文件和未跟踪文件均未发生变化，允许 `.cache/` 等已忽略的本机数据。

PR 判断整个分支的累计差异；若先前已修改包源，后续只改文档仍会验证该 PR 的目标。普通分支 Push 仅修改文档时跳过测试和打包。发布标签代表明确发布请求，仍执行完整发布验证。

预览包名为 `preview-<目标名>`，保留 14 天，包含整合包、`SHA256SUMS` 和 `build-report.json`。工具版本固定，Pakku 下载会核验 SHA-256，构建不更新依赖。

工作流中的 Action 固定为完整 Commit SHA，行尾注释标明核对时的版本标签；更新时核对官方仓库标签指向并重新验证。Node、pnpm、Java 和 Pakku 的工具版本单独固定。Temurin 21.0.10+7 在 `setup-java` 中使用完整版本 `21.0.10+7.0.LTS`，与安装 API 的版本标识一致。

默认 CI 只构建 Modrinth 目标，不提供平台 Token。使用 CurseForge 或 multiplatform 前需要调整凭据及构建流程。CI 不启动游戏，发布流程也不上传到 Modrinth 或 CurseForge。

## 创建发布草稿

先修改 Pakku 包版本，完成检查、构建并提交：

```powershell
pnpm run mp -- pakku --target client-26.2 -- cfg --version A1.3.1
pnpm run mp -- check --all
pnpm run mp -- build --target client-26.2
```

提交后创建并推送标签：

```powershell
git tag release/client-26.2/vA1.3.1
git push origin release/client-26.2/vA1.3.1
```

标签中的目标和版本必须与 Pakku 工程一致。工作流从该提交构建，上传包、校验清单和来源报告，创建草稿。检查文件及游戏表现后，在 GitHub 手动公开。

已有同名标签对应的 Release（包括草稿）不会被覆盖。上传中断时，先检查留下的草稿和错误日志，再决定如何处理，重复运行不会自动清理旧草稿。

## 应用预览包

先按[启动器同步指南](LAUNCHER_SYNC.md)绑定实例并关闭游戏。Apply 接受本工作流生成的 MRPACK，更新现有实例，不新建启动器版本。

本地使用时，把 `.mrpack`、`build-report.json` 和 `SHA256SUMS` 放在同一目录，先预览：

```powershell
pnpm run mp -- apply hmcl-dev --file 'D:\Downloads\preview\Preliminary Art Form-A1.3.1.mrpack'
```

核对文件变化、来源和输出中的包哈希，再执行：

```powershell
pnpm run mp -- apply hmcl-dev --file 'D:\Downloads\preview\Preliminary Art Form-A1.3.1.mrpack' --sha256 <packageHash> --confirm --stopped
```

也可以直接读取 GitHub Actions 运行或 Release：

```powershell
pnpm run mp -- apply hmcl-dev --repo MapManager-group/Preliminary-Art-Form-Modpack --run 123456789
pnpm run mp -- apply hmcl-dev --repo MapManager-group/Preliminary-Art-Form-Modpack --release release/client-26.2/vA1.3.1
```

远端入口同样默认预览，确认时追加 `--sha256 <packageHash> --confirm --stopped`。包发生变化后必须重新预览。遇到内容相同的已有文件，可用 `--adopt-existing` 接管；内容不同则先解决冲突。失败恢复与本地 deploy 相同。

## 下载与来源校验

远端认证读取环境变量 `GH_TOKEN`，其次是 `GITHUB_TOKEN`。Actions 下载需要 Actions 读取权限；私有仓库和发布草稿需要相应仓库读取权限。不要将 Token 写入配置或提交。

Run 入口要求指定仓库的 `ci.yml` 已成功完成，并包含对应目标的有效预览包；纯文档运行没有可应用的包。工具核对 GitHub 资产摘要、提交、目标及包内报告，过期资产、缺失校验信息或权限不足都会报错。也可自行下载完整文件组后使用 `--file`。

预览会联网读取远端包，但不写入实例；确认后才下载缺失依赖并部署。本地文件的哈希证明内容一致，不能证明作者身份，应用前仍需确认来源可信。

Apply 仅支持 MRPACK，并受[开发指南中的归档大小限制](DEVELOPMENT.md#检查与构建)约束。它不修改正式源工程；应用其他提交的配置后，应先对齐本地源，再进行配置回收。

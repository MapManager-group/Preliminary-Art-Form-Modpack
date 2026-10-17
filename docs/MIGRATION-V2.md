# Pakku v2 迁移记录

迁移日期：2026-10-17。项目仍为 Preliminary Art Form，开发别名 LorianDesign；本次改变开发架构，不升级整合包依赖。

## 来源与结果

| 项目 | 基线 |
| --- | --- |
| 旧源码 | `ae7d4af1a1c847d91593672d0a2bcdf81bc66dd3`，工作区 `v1-legacy` |
| v2 模板 | `5151ad6915b98bfe0fbefa8f945cb9dcdd90d0fa`，本地 DB-Modpack-Dev-Workflow/v2 |
| 正式目标 | `client-26.2`，仅交付 Modrinth MRPACK |
| 版本 | Minecraft 26.2、Fabric 0.19.5、包 A1.3.1 |
| Git | 新仓库的 `v2` 无父提交根节点；origin 指向原项目，不推送 |

包内依赖由 Pakku 1.5.0 原生初始化、导入和配置生成；正式工程可以独立使用 Pakku。模板采用 CC0-1.0，项目保留原 MIT 许可证。来源目录不作修改。

原 89 条 packwiz 依赖记录转换为 86 个托管项目、2 个内嵌外部文件和 1 条重复来源记录；另保留自有菜单 JAR。最终正式 overrides 共 141 个文件。[迁移审计](MIGRATION-V2-AUDIT.json)记录迁移时的版本、侧别、哈希和资源来源，仅作历史审计，不参与日常依赖解析。

## 明确的内容差异

- 原 85 个 Modrinth 项目保持精确版本；Architectury 从 CurseForge 转为同哈希的 Modrinth `lhGA9TYQ / bZ8FOeFo`。
- Text Placeholder API 的 Modrinth 与 CurseForge 记录具有相同文件内容、输出路径，合并为 `eXts2L7r / NDqH16LT`，不打包重复 JAR。
- Lorian’s Arch Orbit 无同哈希 Modrinth 结果，从旧包提取并核验 SHA-1 后内嵌；JAR 内声明 MIT。自有菜单 JAR 保留原 SHA-256 白名单记录及 MIT 声明。
- iterationT 从原直链下载并核验 SHA-512，作为光影 ZIP 内嵌。ZIP 中未找到许可证文件，保留原来源记录，不推断其许可证。
- 原旧构建遗漏 iterationT，主菜单配置也与源码不同。迁移采用当前源码，不将旧产物整体当作导入源。
- 移除过时的根 `options.txt`，保留 YoSBR 中更新的默认按键、全屏和界面设置。其余覆盖文件保持原始内容和游戏内路径。
- Async 保持 SERVER 侧别；MRPACK 中为 `client=unsupported, server=required`，客户端同步不会安装它。

工具运行使用 Java 21；现有两个内嵌 Mod 的元数据要求游戏 Java 25 或更新版本。游戏环境由启动器准备，工具 Java 不代表游戏 Java。

## 验证方法

```powershell
pnpm test
pnpm run mp -- check --all
pnpm run mp -- build --target client-26.2
node tools/verify-migration.mjs '<本次构建的 .mrpack>'
pnpm exec node tools/verify-phase1.mjs
pnpm exec node tools/verify-phase2.mjs
pnpm exec node tools/verify-phase3.mjs
pnpm exec node tools/verify-phase4.mjs
```

`verify-migration` 专门核对本次 A1.3.1 迁移快照：86 个托管项目的精确版本、路径、哈希、侧别，以及 141 个资源的字节哈希。未来主动更新整合包时，不应为通过此历史检查而回退新版本。

Phase 1 检查正式工程及隔离副本构建；Phase 2–4 创建独立临时工程与 PCL/HMCL 假实例，验证部署、回收、依赖候选、恢复、Apply 和 CI。不会启动游戏、操作真实实例、推送或发布。

自动化结果在交付时核验；本地日志留在忽略的 `.cache/`。完整单元与菜单测试为 170 项通过、0 失败、0 跳过。Phase 1–4 全部通过，包括正式工程独立复用、真实 Pakku、双启动器临时实例、依赖恢复及 Apply/CI 集成验证。实际 MRPACK 已通过迁移哈希对照，Actions 通过 actionlint。游戏启动、画面和实际建筑功能尚未人工验证。

## 实际问题与模板优化建议

| 分类 | 触发与影响 | 本项目处理 | 模板可改进处 |
| --- | --- | --- | --- |
| 模板缺陷：导入侧别 | 导入含 SERVER 依赖的 MRPACK 时设置 `export_server_side_projects_to_client=true`，Pakku 会把客户端环境改成 required；原模拟测试没有模拟这个开关 | 改为 false，并修正模拟导出，实际构建核对 Async 侧别 | 合并此修复，增加固定 Pakku 的原生 SERVER 导入回归，避免只依赖模拟 |
| 模板耦合：正式示例 | 删除示例 packs 后，单元测试和阶段验证仍读取 `packs/fabric-1.21.1`，97 项测试失败 | 单元测试自行构造 fixture；集成测试用原生 Pakku 在临时目录创建示例 | 将全部测试数据与用户正式目标分离，把“删除示例后仍可测试”纳入模板验收 |
| 模板缺陷：根提交检查 | 默认提交检查使用 HEAD~1，孤儿分支的第一条提交没有父节点 | 默认改用 commitlint `--last`，保留显式区间参数 | 增加零提交、根提交和普通历史三个场景 |
| 已解决的模板限制 | 原模板拒绝内嵌 JAR/ZIP、资源包 assets、默认设置 | 使用最新 5151ad6 的统一内容策略；无需另加路径补丁 | 保留统一策略及真实归档、部署回归，避免再次分散黑名单 |
| 项目数据差异 | 重复来源、旧产物缺光影、菜单配置过时、两份 options 不一致 | 以源码为准，按哈希去重，明确记录排除项 | 导入报告可显示最终安装路径冲突，并支持源码与既有产物的差异摘要 |
| 环境问题 | 沙箱不能执行 Windows 商店 pwsh 别名；旧测试有失败和跳过 | 使用缓存中的便携 PowerShell 7.4.13，完整重跑所有菜单测试 | doctor 可识别不可执行别名并给出实际可执行文件路径；持续显示跳过测试数量 |
| 环境问题 | 工作区目录所有者与运行用户不同，Git 拒绝访问 | 仅对子进程设置当前仓库的 safe.directory，不更改全局信任配置 | 初始化文档可说明此诊断及按目录处理方法 |
| 工作流边界：YoSBR | 游戏通常修改 config 下的生效配置，正式默认值却位于 config/yosbr/config；按路径回收不会自动转换为默认值 | 文档说明人工比对、选择性整理默认配置，不整体回收游戏目录 | 可提供显式的源/运行路径映射与预览，但须保留三方冲突和来源确认 |

以上反馈来自本次实施，未修改模板仓库，也未向上游创建 issue。可复核的上游语义见固定版本的 [Modrinth 导出规则](https://github.com/juraj-hrivnak/Pakku/blob/v1.5.0/src/commonMain/kotlin/teksturepako/pakku/api/actions/export/rules/ModrinthRules.kt)。

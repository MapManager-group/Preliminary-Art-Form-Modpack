# Changelog

## 2026-10-18

### Workflow maintenance

- Sync DB-Modpack-Dev-Workflow v2 commits `3fb65ae`, `94f8d8c`, `f767ff0` and `c1db6df`.
- Share independent test fixtures and verify server-only MRPACK imports with native Pakku.
- Cover empty histories, root commits and initial pushes in commit checks.
- Diagnose PowerShell aliases and executable paths; require menu tests to run in CI.
- Keep production dependency versions, resources, YoSBR defaults and the MIT license unchanged.

## 2026-10-17

### Repository v2 migration

- ♻️ refactor(workflow): migrate from packwiz to Pakku with pnpm, launcher synchronization, isolated builds and draft releases.
- 📦 build(pack): retain Minecraft 26.2, Fabric 0.19.5 and pack version A1.3.1 with exact dependency hashes.
- 🐛 fix(pack): deduplicate Text Placeholder API, include iterationT and retain current source menu settings.
- 🔧 chore(config): keep YoSBR defaults and remove obsolete root options.txt.
- 📝 docs: document provenance, migration verification and template feedback.


## 2026-09-26

### (Modpack)26.2-A1.3.1

- 🔧 chore(mod): 将所有mod更新到最新版本
- 🔧 chore(shader): 将所有shaderpacks更新到最新版本
- 🔧 chore(deps): 将fabric依赖更新到0.19.5

### (Modpack)26.2-A1.3

- 🔧 chore(mod): 将所有mod更新到最新版本
- 🔧 chore(mod): 移除 *Lottweaks*
- 🔧 chore(mod): 移除 *Visual Barrier*
- ✨ feat(mod): 新增 *Lorian‘s Arch Orbit* 并调整了配置文件
- 🔧 chore(config): 调整 *Minihud* *Jade* *Xaero's Minimap* 的信息显示配置
- ✨ feat(mod): 新增 *Mcedia Core*
- ✨ feat(mod): 新增 *McediaTV*
- ✨ feat(mod): 新增 *Mcedia China Media Platforms Resolver*
- 🐛 fix(mod): 禁用 *XaeroPlus* 中传送失败的假消息

### (repo)
- 👷 ci(packwiz): `pack.ps1` 新增更新渠道保护
- 👷 ci(packwiz): 修复 CurseForge 源正式版更新流程

## 2026-08-10

### (Modpack)26.2-A1.2

- 🔧 chore(mod): 将所有mod更新到最新版本
- 🔧 chore(mod): 重新梳理并设计了新版模组列表
- 🐛 fix(mod): 将 *Nitroito-Tooltips* 替换为 *EnhancedTooltips* 以修复一个物品名称显示问题
- ✨ feat(rei): 为REI添加了默认创造建筑工具收藏列表
- ✨ feat(mod): 新增 *Buildup-Menu-Button* 以优化主菜单和暂停菜单的布局
- 🔧 chore(mod): 将 *OrthoCamera* 替换为 *Picture Mode* 以实现更佳效果
- 🐛 fix(mod): 将 *Fast IP Ping* 替换为 *Fast Server Pings* 以修复一个服务器连接问题
- 🐛 fix(mod): 关闭 *Debugify* 的 *MC-251068* 修复以修复无法点击取消的问题
- ⚡ perf(modpack): 移除一些无关Mod以略微优化性能
- 🔧 chore(modpack): 同步更新模组汉化

### (repo)

- 👷 ci(github): 工作流新增多版本支持
- 👷 ci(packwiz): 重做packwiz管理脚本
- 📝 docs(packwiz): 重写packwiz开发文档

## 2026-08-07

### (Modpack)26.2-A1.1

- 🎉 chore(repo): initialize the Minecraft 26.2 and Fabric 0.19.3 packwiz project
- 📦 build(pack): migrate external metadata and curated overrides from the existing Modrinth package
- 🙈 chore(axiom): exclude the blueprint library pending manual migration and license review

### (repo)

- 🐛 fix(ci): normalize packwiz index hashes for LF checkouts
- 👷 ci(workflow): limit modpack validation triggers
- 📝 docs(repo): reorganize project documentation

# Modrinth 打包

本仓库只交付 Modrinth `.mrpack`，当前目标是 `client-26.2`。

```powershell
pnpm run mp -- check --all
pnpm run mp -- build --target client-26.2
```

构建在 `.work/` 副本中运行 Pakku，不更新正式依赖。交付文件位于 `dist/client-26.2/build-*/`，包括整合包、`SHA256SUMS` 和 `build-report.json`，全部由 Git 忽略。

`pakku.json` 保存包名和版本；锁文件保存精确 Minecraft、Fabric 与依赖版本。托管依赖记录在 MRPACK 索引中，正式客户端 overrides 原样内嵌；内嵌 Mod 和光影不自动更新。原服务端侧依赖保留侧别，客户端安装清单跳过它们。

构建检查包内路径、下载记录及覆盖资源哈希。YoSBR 默认设置保留，不打包旧根目录 `options.txt`。完整迁移对照见[迁移记录](MIGRATION-V2.md)。

预览构建、发布标签和 Apply 使用方式见[构建与发布](RELEASE.md)。构建通过不等于已完成游戏启动和功能体验测试。

Pakku 默认同时生成服务端 ZIP。正式 Target 只选择 MRPACK，构建报告将唯一的服务端 ZIP 记为 `excluded`，它留在隔离构建目录，不进入 dist 或 CI/Release 上传。未知产物或多份服务端 ZIP 仍记为 `uncollected` 并阻止发布。不使用 `--no-server`，以保留 MRPACK 中 SERVER 依赖的原始侧别。

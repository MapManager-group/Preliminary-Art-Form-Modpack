# AGENTS.md

- 项目：Preliminary Art Form；开发别名：LorianDesign。
- 本仓库使用 packwiz 管理多版本 Fabric 整合包，仅构建 Modrinth `.mrpack`。
- 外部依赖提交 `.pw.toml`，不要提交 JAR、构建产物、缓存、账号、日志、存档或启动器私有配置。
- 统一使用 `scripts/pack.ps1`；多版本在交互菜单中选择，命令行用 `-Version <目录名>` 指定。
- 修改配置或元数据后运行 `scripts/pack.ps1 refresh`；交付前运行 `scripts/pack.ps1 validate` 和 `scripts/pack.ps1 build`。
- 项目文档默认使用中文；仅 `README_en.md` 使用英文，`docs/CHANGELOG.md` 使用英文。
- Git 提交遵循 `cz.config.js` 的 **Gitmoji + Conventional Commits** 规范，可使用中文内容，例如 `✨ feat(mod): 新增一个建筑辅助mod`。
- 保持提交原子化，不覆盖或夹带无关修改。

# AGENTS.md

- 项目：Preliminary Art Form；开发别名：LorianDesign。
- 本仓库使用 packwiz 管理多版本 Fabric 整合包，仅构建 Modrinth `.mrpack`；当前版本位于 `packwiz/26.2`。
- 外部依赖提交 `.pw.toml`，不要提交 JAR、构建产物、缓存、账号、日志、存档或启动器私有配置。
- 修改配置或元数据后运行 `scripts/refresh.ps1`；交付前运行 `scripts/validate.ps1` 和 `scripts/build.ps1`。
- Axiom `blueprints/` 暂不纳入仓库，等待人工迁移。
- 项目文档默认使用中文；仅 `README_en.md` 使用英文。`CHANGELOG.md` 作为版本日志必须使用英文。
- 更新日志和 Git 提交均采用 **Gitmoji + Conventional Commits**，内容使用英文，例如 `✨ feat(pack): add a building utility mod`。
- 保持提交原子化，不覆盖或夹带无关修改。

# AGENTS.md

- 项目：Preliminary Art Form；开发别名：LorianDesign。
- 本仓库使用 packwiz 管理多实例、多版本 Fabric 整合包，仅构建 Modrinth `.mrpack`；当前只有客户端实例，`packwiz/server/` 必须保持为空目录。
- `packwiz/instances.json` 是实例、版本、路径和 artifact 名称的唯一数据源。
- 外部依赖提交 `.pw.toml`；无公共下载源的自有 JAR 仅可在 `packwiz/local-files.json` 记录精确 SHA-256、原因和许可证后提交。不要提交其他 JAR、构建产物、缓存、账号、日志、存档或启动器私有配置。
- 统一使用 `scripts/pack.ps1`；交互菜单选择实例/版本，命令行用 `-Instance <实例> -Version <版本>` 指定。
- 创建或导入实例使用 `scripts/new-pack.ps1`；导入后必须检查 `import-reports/`。
- 修改配置或元数据后运行 `scripts/pack.ps1 refresh`；交付前运行 `scripts/pack.ps1 validate` 和 `scripts/pack.ps1 build`。
- 项目文档默认使用中文；仅 `README_en.md` 使用英文，`docs/CHANGELOG.md` 使用英文。
- Git 提交遵循 `cz.config.js` 的 **Gitmoji + Conventional Commits** 规范，可使用中文内容，例如 `✨ feat(mod): 新增一个建筑辅助mod`。
- 保持提交原子化，不覆盖或夹带无关修改。

# 贡献指南

修改应尽量限定在 `packwiz/<instance>/<version>/` 下的单个目标中。日常操作使用 `scripts/pack.ps1`；无参数进入实例/版本选择菜单。命令行操作使用 `-Instance` 与 `-Version` 明确指定，例如 `.\scripts\pack.ps1 add sodium -Instance client -Version 26.2`。

提交修改前：

1. 使用 packwiz 添加或更新依赖，不要提交下载后的 JAR；无公共源的自有 JAR 必须登记到 `packwiz/local-files.json` 并锁定 SHA-256。
2. 修改配置等内部文件后运行 `.\scripts\pack.ps1 refresh`；操作指定目标时附加 `-Instance <实例> -Version <版本>`。
3. 运行 `.\scripts\pack.ps1 validate` 和 `.\scripts\pack.ps1 build`，确认校验通过并成功导出 `.mrpack`。
4. 在 `docs/CHANGELOG.md` 中记录影响用户的变更。

推送或创建 Pull Request 后，GitHub Actions 会先检查提交规范。仅当 `packwiz/**`、`scripts/**`、`.github/workflows/validate.yml` 或 `.gitattributes` 变化时，才读取 `packwiz/instances.json`，独立校验、构建每个登记目标并上传 artifact；手动运行工作流时始终打包。

禁止提交启动器配置、账号数据、缓存、日志、存档和生成的 `.mrpack` 文件。

## Git 与更新日志规范

提交信息和 `docs/CHANGELOG.md` 遵循 **Gitmoji + Conventional Commits**：

```text
✨ feat(pack): add a building utility mod
🐛 fix(config): correct the default key binding
📝 docs(readme): clarify the build workflow
```

每个提交应保持原子性，类型和作用域应准确表达变更。不要在同一提交中混入无关修改。

暂存本次原子化修改后，通过 Commitizen 的 `cz-git` 交互式生成提交信息：

```powershell
git add <本次修改的文件>
npm run commit
```

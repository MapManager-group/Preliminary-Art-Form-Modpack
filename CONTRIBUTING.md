# 贡献指南

修改应尽量限定在 `packwiz/` 下的单个 Minecraft 版本目录中。日常操作使用 `scripts/pack.ps1`；无参数进入交互菜单，存在多个版本时会先选择目标版本。命令行操作可用 `-Version` 明确指定，例如 `.\scripts\pack.ps1 -Version 26.3 add sodium`。

提交修改前：

1. 使用 packwiz 添加或更新依赖，不要提交下载后的 JAR 文件。
2. 修改配置等内部文件后运行 `.\scripts\pack.ps1 refresh`；操作指定版本时附加 `-Version <版本目录名>`。
3. 运行 `.\scripts\pack.ps1 validate` 和 `.\scripts\pack.ps1 build`，确认校验通过并成功导出 `.mrpack`。
4. 在 `docs/CHANGELOG.md` 中记录影响用户的变更。

推送或创建 Pull Request 后，GitHub Actions 会自动扫描所有包含 `pack.toml` 的版本目录。每个版本会独立校验、构建，并上传一个以 Minecraft 版本命名的 ZIP artifact。

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

# 贡献指南

修改应尽量限定在 `packwiz/` 下的单个 Minecraft 版本目录中。

提交修改前：

1. 使用 packwiz 添加或更新依赖，不要提交下载后的 JAR 文件。
2. 修改配置等内部文件后运行 `scripts/refresh.ps1`。
3. 运行 `scripts/validate.ps1` 和 `scripts/build.ps1`。
4. 在 `docs/CHANGELOG.md` 中记录影响用户的变更。

禁止提交启动器配置、账号数据、缓存、日志、存档和生成的 `.mrpack` 文件。

## Git 与更新日志规范

提交信息和 `docs/CHANGELOG.md` 条目使用英文，并遵循 **Gitmoji + Conventional Commits**：

```text
✨ feat(pack): add a building utility mod
🐛 fix(config): correct the default key binding
📝 docs(readme): clarify the build workflow
```

每个提交应保持原子性，类型和作用域应准确表达变更。不要在同一提交中混入无关修改。

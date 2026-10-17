# 贡献指南

修改应限定在明确的 Target 或工具行为内。当前目标为 `client-26.2`；日常通过 `ci.ps1` 菜单或 `pnpm run mp -- … --target client-26.2` 操作。

提交前：

1. 使用 Pakku 添加、移除或更新托管依赖，不手写锁文件，不将下载缓存作为源提交。
2. 需要随包分发的自有 Mod、默认配置和资源放入正式 overrides；新增或替换内嵌文件时记录来源、许可与哈希。迁移审计只记录迁移时状态，不作为日常依赖清单。
3. 运行 `pnpm test`、`pnpm run mp -- check --all` 和 `pnpm run mp -- build --target client-26.2`。修改菜单运行菜单测试，修改 Actions 运行 actionlint。
4. 在临时测试实例中验证行为；涉及游戏体验的修改还需实际启动游戏验证。在 `docs/CHANGELOG.md` 添加英文用户可见变更。

禁止提交账号、凭据、启动器私人配置、存档、日志、缓存和生成产物。正式配置与资源遵循统一内容策略；不要扩大扩展名或关键词黑名单。

## Git 与更新日志规范

提交遵循 Gitmoji + Conventional Commits，例如：

```text
✨ feat(mod): add a building utility mod
🐛 fix(config): correct the default key binding
📝 docs(development): document the Pakku workflow
```

保持提交原子性，先检查 `git status` 和 `git diff`，暂存需要的文件，再运行 `pnpm run commit`、`pnpm run lint:commits`。检查历史区间可用 `pnpm run lint:commits -- --from <base> --to HEAD`。

CI 按目标和公共工具变更选择检查与构建；纯文档提交仍检查提交规范。详细说明见[开发指南](docs/DEVELOPMENT.md)和[构建与发布](docs/RELEASE.md)。

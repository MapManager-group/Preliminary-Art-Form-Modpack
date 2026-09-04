# Packwiz 工程目录

- `client/26.2/`：Preliminary Art Form 当前客户端工程。
- `server/`：服务端预留目录；本整合包当前没有服务端实例，只保留 `.gitkeep`，不登记到 `instances.json`。
- `instances.json`：本地 CLI 和 GitHub Actions 使用的实例/版本清单。
- `local-files.json`：无法转换为外部 `.pw.toml` 的自有文件允许清单，每项必须记录 SHA-256、原因和许可证。

不要在 `server/` 中复制客户端工程。将来真正增加服务端实例时，应创建独立的 `pack.toml` 并登记到 `instances.json`。

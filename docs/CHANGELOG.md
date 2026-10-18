# Changelog

## 2026-10-19

### Pakku

- 同步模板仓库，修复批量导入配置默认值校验与联合写入

### Modpack

- 清理配置文件
- 新增 Radial & Renice Shot
- 更新 lorain-arch-orbit 至 v1.2.0

## 2026-10-18

### Workflow maintenance

- Sync DB-Modpack-Dev-Workflow v2 commits `3fb65ae`, `94f8d8c`, `f767ff0` and `c1db6df`.
- Share independent test fixtures and verify server-only MRPACK imports with native Pakku.
- Cover empty histories, root commits and initial pushes in commit checks.
- Diagnose PowerShell aliases and executable paths; require menu tests to run in CI.
- Exclude the unselected native ServerPack ZIP from delivery without removing SERVER records from the MRPACK; unexpected outputs still block CI and releases.
- Keep production dependency versions, resources, YoSBR defaults and the MIT license unchanged.

## 2026-10-17

### Repository v2 migration

- ♻️ refactor(workflow): migrate from packwiz to Pakku with pnpm, launcher synchronization, isolated builds and draft releases.
- 📦 build(pack): retain Minecraft 26.2, Fabric 0.19.5 and pack version A1.3.1 with exact dependency hashes.
- 🐛 fix(pack): deduplicate Text Placeholder API, include iterationT and retain current source menu settings.
- 🔧 chore(config): keep YoSBR defaults and remove obsolete root options.txt.
- 📝 docs: document provenance, migration verification and template feedback.

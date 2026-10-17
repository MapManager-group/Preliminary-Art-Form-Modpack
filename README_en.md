# Preliminary Art Form

[简体中文](README.md)

> "preliminary art form" is about the trance you have when working on a thing for so long that it becomes second nature.
>
> -- C418, One.

A simple yet comprehensive modpack dedicated to building, with the creative tools and utilities needed for architectural work.

**Preliminary Art Form** began as a custom client for the **LorianStudio** building community server, hence its internal development alias **LorianDesign**. It is planned to evolve into a multi-version, all-purpose building and design modpack for vanilla Minecraft.

---

This is the development repository for **Preliminary Art Form**, managed with [Pakku](https://github.com/juraj-hrivnak/Pakku), pnpm and JavaScript ESM. It distributes Modrinth `.mrpack` packages only.

## Current development version (WIP)

| Minecraft | Loader | Pack version | Target |
| --- | --- | --- | --- |
| 26.2 | Fabric 0.19.5 | A1.3.1 | `client-26.2` |

The sole production target is the client project in `packs/client-26.2`. `workspace.json` registers targets; `pakku.json` defines pack metadata and export settings; `pakku-lock.json` records exact game, loader and managed dependency versions. Authored files live in `.pakku/client-overrides/`.

## Quick start

Install Git, Node.js 24, pnpm 10.28.2 and Java 21. The local menu requires PowerShell 7.3+. Java 21 runs Pakku; the launcher manages the Java version required by Minecraft itself.

```powershell
pnpm install --frozen-lockfile
pnpm run mp -- bootstrap
pnpm run mp -- doctor
pnpm run mp -- check --all
pnpm run mp -- build --target client-26.2
.\ci.ps1
```

Use `pnpm run mp -- help` for the CLI. `ci.ps1` provides the interactive menu; `tools/` implements build, dependency and launcher workflows; `tests/` uses disposable instances. Build output is stored in `dist/client-26.2/build-*/`, including the MRPACK, `SHA256SUMS` and `build-report.json`.

CI checks affected targets and builds preview artifacts. First branch pushes and manual runs cover every target. Release tags create GitHub drafts only; they do not publish to Modrinth automatically. Local bindings, caches, staging data and artifacts are ignored by Git.

YoSBR supplies default settings; the obsolete root `options.txt` is excluded. Lorian’s Arch Orbit, the project-owned menu mod and iterationT remain embedded overrides, with provenance and hashes recorded in the migration audit. Managed dependencies are maintained exclusively through Pakku.

## Contributions and documentation

Use **Gitmoji + Conventional Commits**, for example `✨ feat(mod): add a building utility`. Stage relevant files, run `pnpm run commit`, then `pnpm run lint:commits`. Chinese subjects and custom scopes are supported; the maximum title length is 72 characters.

Project guides are maintained in Chinese:

- [Development](docs/DEVELOPMENT.md)
- [Packaging](docs/PACKAGING.md)
- [Launcher synchronization](docs/LAUNCHER_SYNC.md)
- [Builds and releases](docs/RELEASE.md)
- [Architecture](docs/WORKFLOW_ARCHITECTURE.md)
- [Minecraft 26.2 migration](docs/MIGRATION-26.2.md)
- [Pakku v2 migration and template feedback](docs/MIGRATION-V2.md)
- [Changelog](docs/CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

The project retains its [MIT license](LICENSE). The workflow derives from the CC0-1.0 [DB-Modpack-Dev-Workflow v2 template](https://github.com/DavidBlackCN/DB-Modpack-Dev-Workflow). Third-party mods, tools and assets retain their own licenses.

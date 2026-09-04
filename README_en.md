# Preliminary Art Form

[简体中文](README.md)

> "preliminary art form" is about the trance you have when working on a thing for so long that it becomes second nature.
>
> -- C418, One.

A simple yet comprehensive modpack dedicated to building, with the creative tools and utilities needed for architectural work.

**Preliminary Art Form** began as a custom client for the **LorianStudio** building community server, hence its internal development alias **LorianDesign**. It is planned to evolve into a multi-version, all-purpose building and design modpack for vanilla Minecraft.

---

This repository contains the development sources for **Preliminary Art Form**. It is managed with [packwiz](https://packwiz.infra.link/) and only produces Modrinth `.mrpack` packages.

## Current development version (WIP)

| Minecraft | Loader        | Pack version | Packwiz project  |
| --------- | ------------- | ------------ | ---------------- |
| 26.2      | Fabric 0.19.3 | 26.2-A1.3    | `packwiz/client/26.2` |

Only the client instance currently exists. `packwiz/server/` is an empty reserved directory and is not built.

## Repository layout

```text
.
├─ packwiz/
│  ├─ instances.json                 # Single source of truth for local scripts and CI
│  ├─ local-files.json               # Allowlist and SHA-256 hashes for controlled local files
│  ├─ client/
│  │  └─ 26.2/                       # Current Preliminary Art Form client project
│  └─ server/                        # Empty directory reserved for a future server instance
├─ scripts/
│  ├─ pack.ps1                       # Unified CLI for dependency management, validation, and builds
│  ├─ new-pack.ps1                   # Scaffold an empty project or import an mrpack instance
│  ├─ import-mrpack.ps1              # Convert mrpack metadata/overrides with auditing and rollback
│  ├─ discover-packs.ps1             # Validate the manifest and emit the GitHub Actions matrix
│  ├─ validate.ps1                   # Validate sensitive files, local hashes, and the packwiz index
│  └─ normalize-pack-line-endings.ps1 # Normalize line endings in packwiz text files
└─ .github/workflows/validate.yml    # Commit lint and multi-instance validation/build workflow
```

Script responsibilities:

| Script | Purpose |
| --- | --- |
| `pack.ps1` | The day-to-day entry point for selecting a target and running add, remove, update, pin, unpin, list, refresh, validate, or build. |
| `new-pack.ps1` | Scaffolds an empty instance or imports an existing `.mrpack` with `-ImportMrpack`. |
| `import-mrpack.ps1` | Resolves mrpack metadata and dependencies, migrates overrides, writes an audit report, and rolls back failed imports. |
| `discover-packs.ps1` | Validates unique targets, project paths, and `pack.toml`, then emits the CI matrix JSON. |
| `validate.ps1` | Checks runtime/sensitive files, unapproved JARs, local-file hashes, and consistency between the index and `.pw.toml` files. |
| `normalize-pack-line-endings.ps1` | Applies the repository line-ending policy to packwiz text files to prevent index hash drift. |

## Quick start

Place `packwiz.exe` in the repository root. Use `pack.ps1` as the single entry point for day-to-day work:

```powershell
.\scripts\pack.ps1                                      # Interactive management; choose an instance and version
.\scripts\pack.ps1 validate                             # Validate the default client/26.2 target
.\scripts\pack.ps1 build                                # Build the default target's .mrpack
.\scripts\pack.ps1 build -Instance client -Version 26.2 # Build a specific target
```

Local build artifacts are written to `dist/`. GitHub Actions always checks commit messages, but only discovers, validates, and builds the targets in `packwiz/instances.json` when `packwiz/**`, `scripts/**`, `.github/workflows/validate.yml`, or `.gitattributes` changes. Manual runs always build all targets. Project documentation is maintained in Chinese; see the [development guide](docs/DEVELOPMENT.md).

## Project documentation

- [Development guide](docs/DEVELOPMENT.md) (Chinese)
- [Modrinth packaging](docs/PACKAGING.md) (Chinese)
- [Minecraft 26.2 migration notes](docs/MIGRATION-26.2.md) (Chinese)
- [Changelog](docs/CHANGELOG.md) (English)

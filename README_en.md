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
| 26.2      | Fabric 0.19.3 | 26.2-A1.1    | `packwiz/26.2` |

## Quick start

Place `packwiz.exe` in the repository root. Use `pack.ps1` as the single entry point for day-to-day work:

```powershell
.\scripts\pack.ps1                              # Interactive management; choose a version when multiple exist
.\scripts\pack.ps1 validate                     # Validate the default version
.\scripts\pack.ps1 build                        # Build the default version's .mrpack
.\scripts\pack.ps1 -Version 26.2 build          # Build a specific version
```

Local build artifacts are written to `dist/`. GitHub Actions automatically discovers every version under `packwiz/`, validates and builds each one, then uploads a version-named ZIP artifact. Project documentation is maintained in Chinese; see the [development guide](docs/DEVELOPMENT.md).

## Project documentation

- [Development guide](docs/DEVELOPMENT.md) (Chinese)
- [Modrinth packaging](docs/PACKAGING.md) (Chinese)
- [Minecraft 26.2 migration notes](docs/MIGRATION-26.2.md) (Chinese)
- [Changelog](docs/CHANGELOG.md) (English)

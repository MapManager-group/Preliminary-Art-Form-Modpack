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

| Minecraft | Loader        | Pack version | Packwiz project |
| --------- | ------------- | ------------ | --------------- |
| 26.2      | Fabric 0.19.3 | 26.2-A1.1    | `packwiz/26.2`  |

## Quick start

Place `packwiz.exe` in the repository root and run:

```powershell
.\scripts\validate.ps1 -MinecraftVersion 26.2
.\scripts\build.ps1 -MinecraftVersion 26.2
```

Build artifacts are written to `.\dist`. Project documentation is maintained in Chinese; see the [development guide](docs/DEVELOPMENT.md).

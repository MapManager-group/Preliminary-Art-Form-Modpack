# Preliminary Art Form

[English](README_en.md)

> "preliminary art form" is about the trance you have when working on a thing for so long that it becomes second nature.
>
> -- C418, One.

一个简单且全面的建筑专用整合包，包含了所有你需要的建筑创作工具和辅助功能。

**Preliminary Art Form** 起初是为 **LorianStudio** 的建筑社区服务器设计的定制客户端，因此有内部开发别名 **LorianDesign**，后续计划发展为支持多版本的原版 Minecraft 全能建筑设计整合包。

---

本仓库为 **Preliminary Art Form** 的项目开发仓库，使用 [packwiz](https://packwiz.infra.link/) 进行项目管理，仅提供 Modrinth `.mrpack` 格式构建。

## 当前开发版本（WIP）

| Minecraft | Loader        | Pack version | Packwiz project  |
| --------- | ------------- | ------------ | ---------------- |
| 26.2      | Fabric 0.19.3 | 26.2-A1.1    | `packwiz/26.2` |

## 快速开始

将 `packwiz.exe` 放在根目录下；日常操作统一通过 `pack.ps1` 完成：

```powershell
.\scripts\pack.ps1                              # 交互式管理；多版本时先选择版本
.\scripts\pack.ps1 validate                     # 校验默认版本
.\scripts\pack.ps1 build                        # 构建默认版本的 .mrpack
.\scripts\pack.ps1 -Version 26.2 build          # 构建指定版本
```

本地构建产物位于 `dist/` 目录。GitHub Actions 会自动发现 `packwiz/` 下的全部版本，分别校验、构建并上传以 Minecraft 版本命名的 ZIP artifact。详细信息请参阅 [开发指南](docs/DEVELOPMENT.md)。

## 项目文档

- [开发指南](docs/DEVELOPMENT.md)
- [Modrinth 打包说明](docs/PACKAGING.md)
- [Minecraft 26.2 迁移记录](docs/MIGRATION-26.2.md)
- [更新日志](docs/CHANGELOG.md)

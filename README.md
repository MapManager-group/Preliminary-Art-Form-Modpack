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
| 26.2      | Fabric 0.19.3 | 26.2-A1.3    | `packwiz/client/26.2` |

当前只有客户端实例；`packwiz/server/` 是空的服务端预留目录，不参与构建。

## 项目结构

```text
.
├─ packwiz/
│  ├─ instances.json                 # 实例/版本清单，也是本地脚本与 CI 的唯一数据源
│  ├─ local-files.json               # 受控本地文件允许清单及 SHA-256
│  ├─ client/
│  │  └─ 26.2/                       # 当前 Preliminary Art Form 客户端工程
│  └─ server/                        # 空的服务端预留目录
├─ scripts/
│  ├─ pack.ps1                       # 统一 CLI：依赖管理、刷新、校验、构建与参数透传
│  ├─ new-pack.ps1                   # 脚手架入口：创建空工程或从 mrpack 导入实例
│  ├─ import-mrpack.ps1              # mrpack 转换、覆盖文件迁移、审计报告与失败回滚
│  ├─ discover-packs.ps1             # 校验实例清单并输出 GitHub Actions matrix
│  ├─ validate.ps1                   # 校验敏感文件、本地文件哈希及 packwiz 索引
│  └─ normalize-pack-line-endings.ps1 # 规范 packwiz 文本文件换行
└─ .github/workflows/validate.yml    # 提交规范检查及多实例校验/构建工作流
```

脚本职责：

| 脚本 | 用途 |
| --- | --- |
| `pack.ps1` | 日常唯一入口；选择实例/版本并执行 add、remove、update、pin、unpin、list、refresh、validate、build。 |
| `new-pack.ps1` | 新实例脚手架；既可创建空工程，也可通过 `-ImportMrpack` 导入已有 `.mrpack`。 |
| `import-mrpack.ps1` | 解析 `.mrpack` 元数据与依赖、迁移覆盖文件、生成导入报告，并在失败时回滚。 |
| `discover-packs.ps1` | 校验 `instances.json` 的唯一性、路径与 `pack.toml`，输出 CI matrix JSON。 |
| `validate.ps1` | 检查运行时或敏感文件、未批准 JAR、本地文件哈希，以及索引与 `.pw.toml` 的一致性。 |
| `normalize-pack-line-endings.ps1` | 根据仓库 Git 属性统一 packwiz 文本文件换行，避免索引哈希漂移。 |

## 快速开始

将 `packwiz.exe` 放在根目录下；日常操作统一通过 `pack.ps1` 完成：

```powershell
.\scripts\pack.ps1                                      # 交互式管理；先选择实例与版本
.\scripts\pack.ps1 validate                             # 校验默认目标 client/26.2
.\scripts\pack.ps1 build                                # 构建默认目标的 .mrpack
.\scripts\pack.ps1 build -Instance client -Version 26.2 # 构建指定目标
```

本地构建产物位于 `dist/` 目录。GitHub Actions 会检查提交规范；仅当 `packwiz/**`、`scripts/**`、`.github/workflows/validate.yml` 或 `.gitattributes` 发生变化时，才根据 `packwiz/instances.json` 自动发现全部实例/版本，分别校验、构建并上传独立 artifact。手动触发始终执行打包。详细信息请参阅 [开发指南](docs/DEVELOPMENT.md)。

## 项目文档

- [开发指南](docs/DEVELOPMENT.md)
- [Modrinth 打包说明](docs/PACKAGING.md)
- [Minecraft 26.2 迁移记录](docs/MIGRATION-26.2.md)
- [更新日志](docs/CHANGELOG.md)

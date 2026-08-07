# Minecraft 26.2 迁移记录

来源：本地解压的 `LorianDesign26.2-A1.1` Modrinth 整合包。

## 外部文件

- 共识别出 90 个源文件条目。
- 其中 88 个使用精确的 Modrinth 项目 ID 和版本 ID 重建。
- 其余 2 个保留为固定哈希的直接下载项。

## 排除内容

以下源数据被有意排除，没有迁移：

- `PCL/` 启动器专属状态
- `config/axiom/blueprints/` 及其 YoSBR 镜像
- Axiom 针对特定服务器的快捷栏状态
- ViaFabricPlus 账号数据
- ViaBedrock blob 缓存

源解压目录继续作为本地迁移参考，并由 Git 忽略。

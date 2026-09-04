# Modrinth 打包

本仓库只生成 Modrinth `.mrpack` 文件。

```powershell
.\scripts\pack.ps1 validate -Instance client -Version 26.2
.\scripts\pack.ps1 build -Instance client -Version 26.2
```

构建产物保存在 `dist/` 中，并由 Git 忽略。

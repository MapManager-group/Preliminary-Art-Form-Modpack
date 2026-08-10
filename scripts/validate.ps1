param(
    [string]$MinecraftVersion = "26.2",
    [switch]$PromptCleanForbidden
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$packDirectory = Join-Path $repoRoot "packwiz/$MinecraftVersion"
$packwizExecutable = Join-Path $repoRoot "packwiz.exe"
$cacheDirectory = Join-Path $repoRoot ".packwiz-cache"

if (-not (Test-Path -LiteralPath $packwizExecutable -PathType Leaf)) {
    throw "packwiz.exe was not found in the repository root."
}
if (-not (Test-Path -LiteralPath (Join-Path $packDirectory "pack.toml") -PathType Leaf)) {
    throw "Unknown Minecraft version: $MinecraftVersion"
}

# ── 1. 敏感文件 / 运行时残留检查 ──
$forbiddenDirectories = Get-ChildItem -LiteralPath $packDirectory -Recurse -Directory | Where-Object {
    $_.Name -in @("blueprints", "blob_cache", "hotbars")
}
$forbiddenFiles = Get-ChildItem -LiteralPath $packDirectory -Recurse -File | Where-Object {
    $_.Name -in @("accounts.json", "launcher_accounts.json", "usercache.json") -or
    $_.Extension -in @(".log", ".bak", ".backup")
}
if ($forbiddenDirectories -or $forbiddenFiles) {
    $paths = @($forbiddenDirectories.FullName) + @($forbiddenFiles.FullName)
    if (-not $PromptCleanForbidden) {
        throw "Forbidden runtime or deferred content found:`n$($paths -join "`n")"
    }

    Write-Output "⚠ 发现不应纳入整合包的运行时或延后迁移内容：`n$($paths -join "`n")"
    $answer = Read-Host '是否删除以上路径并继续校验？[y/N]'
    if ($answer.Trim().ToLowerInvariant() -notin @('y', 'yes')) {
        throw "Forbidden runtime or deferred content found:`n$($paths -join "`n")"
    }

    $packRoot = ([System.IO.Path]::GetFullPath($packDirectory)).TrimEnd('\', '/')
    foreach ($path in $paths) {
        $resolvedPath = (Resolve-Path -LiteralPath $path).Path
        if (-not $resolvedPath.StartsWith("$packRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to delete path outside the selected pack: $resolvedPath"
        }
        Remove-Item -LiteralPath $resolvedPath -Recurse -Force
    }
    Write-Output "✓ 已清理 $($paths.Count) 个运行时或延后迁移路径"
}

Write-Output "✓ 无敏感/运行时残留文件"

# ── 2. refresh + list ──
Push-Location $packDirectory
try {
    New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
    & $packwizExecutable --cache $cacheDirectory refresh
    if ($LASTEXITCODE -ne 0) {
        throw "packwiz refresh failed with exit code $LASTEXITCODE"
    }
    & $packwizExecutable --cache $cacheDirectory list | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "packwiz list failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Output "✓ packwiz refresh & list 通过"

# ── 3. 元数据完整性校验（替代硬编码 90）──
$pwTomlFiles = Get-ChildItem -LiteralPath $packDirectory -Recurse -File -Filter "*.pw.toml"
$diskCount   = $pwTomlFiles.Count

# 磁盘上的相对路径（统一为斜杠以匹配 index.toml 格式）
$diskSlugs = $pwTomlFiles | ForEach-Object {
    $_.FullName.Substring($packDirectory.Length + 1) -replace '\\', '/'
}

# 从 index.toml 提取所有 .pw.toml 条目（外部依赖元数据）
# 格式示例:
#   [[files]]
#   file = "mods/sodium.pw.toml"
#   hash = "..."
#   metafile = true
$indexPath = Join-Path $packDirectory "index.toml"
$indexContent = Get-Content $indexPath -Raw
$indexMetafiles = @(
    [regex]::Matches($indexContent, '(?m)^file\s*=\s*"([^"]+\.pw\.toml)"') |
        ForEach-Object { $_.Groups[1].Value }
)
$indexCount = $indexMetafiles.Count

# 双向校验
$missingInIndex = @($diskSlugs | Where-Object { $_ -notin $indexMetafiles })
$missingOnDisk  = @($indexMetafiles | Where-Object { $_ -notin $diskSlugs })

if ($missingInIndex.Count -gt 0) {
    throw "Metadata files on disk but missing from index.toml:`n$($missingInIndex -join "`n")"
}
if ($missingOnDisk.Count -gt 0) {
    throw "Metadata files in index.toml but missing from disk:`n$($missingOnDisk -join "`n")"
}
if ($diskCount -ne $indexCount) {
    throw "Mismatch: $diskCount .pw.toml on disk vs $indexCount in index.toml"
}

Write-Output "✓ 元数据完整性: $diskCount 个 .pw.toml 文件与 index.toml 一致"
Write-Output "✓ Validated Minecraft ${MinecraftVersion}: $diskCount external files; no deferred or sensitive paths found."

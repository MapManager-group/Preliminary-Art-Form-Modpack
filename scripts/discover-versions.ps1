# CI helper: 输出所有 packwiz 版本目录的 JSON 数组
# 供 GitHub Actions matrix strategy 使用

$repoRoot = Resolve-Path "$PSScriptRoot/.." | Select-Object -ExpandProperty Path

$versions = Get-ChildItem (Join-Path $repoRoot 'packwiz') -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'pack.toml') -PathType Leaf } |
    ForEach-Object { $_.Name } |
    Sort-Object

if (-not $versions) {
    throw 'No packwiz version directories found under packwiz/'
}

# -InputObject 防止 PowerShell 在仅有一个版本时将数组枚举为标量。
# GitHub Actions 的 matrix 必须接收 JSON 数组，如 ["26.2"]，而非 "26.2"。
ConvertTo-Json -InputObject @($versions) -Compress

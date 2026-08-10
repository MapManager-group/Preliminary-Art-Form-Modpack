# CI helper: 输出所有 packwiz 版本目录的 JSON 数组
# 供 GitHub Actions matrix strategy 使用

$repoRoot = Resolve-Path "$PSScriptRoot/.." | Select-Object -ExpandProperty Path

$versions = Get-ChildItem (Join-Path $repoRoot 'packwiz') -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'pack.toml') -PathType Leaf } |
    ForEach-Object { $_.Name }

if (-not $versions) {
    throw 'No packwiz version directories found under packwiz/'
}

@($versions) | ConvertTo-Json -Compress

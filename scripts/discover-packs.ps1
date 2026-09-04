#requires -Version 7.0

# CI helper：校验 packwiz/instances.json 并输出 GitHub Actions matrix JSON。

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path
$manifestPath = Join-Path $repoRoot 'packwiz/instances.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Missing packwiz/instances.json'
}

$manifest = Get-Content $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
$packs = @($manifest.packs)
if (-not $packs) { throw 'packwiz/instances.json must contain a non-empty packs array' }

$seenKeys = @{}
$seenPaths = @{}
$matrix = foreach ($pack in $packs) {
    foreach ($field in @('instance', 'version', 'path', 'artifact')) {
        if (-not $pack.$field) { throw "Missing '$field' in packwiz/instances.json" }
    }

    $key = "$($pack.instance)/$($pack.version)"
    if ($seenKeys.ContainsKey($key)) { throw "Duplicate pack target: $key" }
    $seenKeys[$key] = $true

    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $pack.path))
    $repoPrefix = $repoRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Pack path must be inside the repository: $($pack.path)"
    }
    if ($seenPaths.ContainsKey($fullPath)) { throw "Duplicate pack path: $($pack.path)" }
    $seenPaths[$fullPath] = $true
    if (-not (Test-Path -LiteralPath (Join-Path $fullPath 'pack.toml') -PathType Leaf)) {
        throw "pack.toml not found for $key at $($pack.path)"
    }

    [ordered]@{
        instance = [string]$pack.instance
        version = [string]$pack.version
        path = ([string]$pack.path).Replace('\', '/')
        artifact = [string]$pack.artifact
    }
}

if ($manifest.default) {
    $defaultKey = "$($manifest.default.instance)/$($manifest.default.version)"
    if (-not $seenKeys.ContainsKey($defaultKey)) {
        throw "Default target does not exist: $defaultKey"
    }
}

ConvertTo-Json -InputObject @($matrix) -Compress

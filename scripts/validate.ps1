param(
    [string]$MinecraftVersion = "26.2"
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

$forbiddenDirectories = Get-ChildItem -LiteralPath $packDirectory -Recurse -Directory | Where-Object {
    $_.Name -in @("blueprints", "blob_cache", "hotbars")
}
$forbiddenFiles = Get-ChildItem -LiteralPath $packDirectory -Recurse -File | Where-Object {
    $_.Name -in @("accounts.json", "launcher_accounts.json", "usercache.json") -or
    $_.Extension -in @(".log", ".bak", ".backup")
}
if ($forbiddenDirectories -or $forbiddenFiles) {
    $paths = @($forbiddenDirectories.FullName) + @($forbiddenFiles.FullName)
    throw "Forbidden runtime or deferred content found:`n$($paths -join "`n")"
}

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

$metadataCount = (Get-ChildItem -LiteralPath $packDirectory -Recurse -File -Filter "*.pw.toml").Count
if ($metadataCount -ne 90) {
    throw "Expected 90 external metadata files, found $metadataCount."
}

Write-Output "Validated Minecraft ${MinecraftVersion}: $metadataCount external files; no deferred or sensitive paths found."

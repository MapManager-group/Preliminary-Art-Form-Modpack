param(
    [string]$MinecraftVersion = "26.2"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$packwizExecutable = Join-Path $repoRoot "packwiz.exe"
$packDirectory = Join-Path $repoRoot "packwiz/$MinecraftVersion"
$cacheDirectory = Join-Path $repoRoot ".packwiz-cache"

if (-not (Test-Path -LiteralPath $packwizExecutable -PathType Leaf)) {
    throw "packwiz.exe was not found in the repository root."
}
if (-not (Test-Path -LiteralPath (Join-Path $packDirectory "pack.toml") -PathType Leaf)) {
    throw "Unknown Minecraft version: $MinecraftVersion"
}

Push-Location $packDirectory
try {
    New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
    & $packwizExecutable --cache $cacheDirectory refresh
    if ($LASTEXITCODE -ne 0) {
        throw "packwiz refresh failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

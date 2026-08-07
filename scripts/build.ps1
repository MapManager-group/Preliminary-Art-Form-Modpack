param(
    [string]$MinecraftVersion = "26.2"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$packwizExecutable = Join-Path $repoRoot "packwiz.exe"
$packDirectory = Join-Path $repoRoot "packwiz/$MinecraftVersion"
$distDirectory = Join-Path $repoRoot "dist"
$cacheDirectory = Join-Path $repoRoot ".packwiz-cache"

if (-not (Test-Path -LiteralPath $packwizExecutable -PathType Leaf)) {
    throw "packwiz.exe was not found in the repository root."
}

$packFile = Join-Path $packDirectory "pack.toml"
if (-not (Test-Path -LiteralPath $packFile -PathType Leaf)) {
    throw "Unknown Minecraft version: $MinecraftVersion"
}

$versionLine = Select-String -LiteralPath $packFile -Pattern '^version = "([^"]+)"$'
if (-not $versionLine) {
    throw "The pack version is missing from $packFile"
}
$packVersion = $versionLine.Matches[0].Groups[1].Value
$outputName = "Preliminary Art Form_{0}.mrpack" -f $packVersion
New-Item -ItemType Directory -Force -Path $distDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
$outputPath = Join-Path $distDirectory $outputName

Push-Location $packDirectory
try {
    & $packwizExecutable --cache $cacheDirectory modrinth export --output $outputPath
    if ($LASTEXITCODE -ne 0) {
        throw "packwiz Modrinth export failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Output $outputPath

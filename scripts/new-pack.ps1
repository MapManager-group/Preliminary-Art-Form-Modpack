#requires -Version 7.0

[CmdletBinding(DefaultParameterSetName = 'Create')]
param(
    [Parameter(Mandatory)]
    [string]$Instance,

    [Parameter(Mandatory, ParameterSetName = 'Create')]
    [Parameter(ParameterSetName = 'Import')]
    [string]$MinecraftVersion,

    [Parameter(Mandatory, ParameterSetName = 'Create')]
    [Parameter(ParameterSetName = 'Import')]
    [string]$FabricVersion,

    [Parameter(Mandatory, ParameterSetName = 'Create')]
    [Parameter(ParameterSetName = 'Import')]
    [string]$Name,

    [Parameter(Mandatory, ParameterSetName = 'Import')]
    [string]$ImportMrpack,

    [string]$PackVersion,
    [string]$Author = 'Your Name',
    [string]$Artifact,
    [switch]$SetDefault,

    [Parameter(ParameterSetName = 'Import')]
    [ValidateSet('client', 'server')]
    [string]$OverrideEnvironment,

    [Parameter(ParameterSetName = 'Import')]
    [switch]$SkipUnresolvedEmbeddedFiles
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path
$manifestPath = Join-Path $repoRoot 'packwiz/instances.json'

if ($PSCmdlet.ParameterSetName -eq 'Import') {
    $importParameters = @{
        Instance = $Instance
        ImportMrpack = $ImportMrpack
        Author = $Author
        SetDefault = $SetDefault
        SkipUnresolvedEmbeddedFiles = $SkipUnresolvedEmbeddedFiles
    }
    foreach ($parameterName in @('MinecraftVersion', 'FabricVersion', 'Name', 'PackVersion', 'Artifact', 'OverrideEnvironment')) {
        if ($PSBoundParameters.ContainsKey($parameterName)) {
            $importParameters[$parameterName] = $PSBoundParameters[$parameterName]
        }
    }
    & (Join-Path $PSScriptRoot 'import-mrpack.ps1') @importParameters
    return
}

if (-not $PackVersion) { $PackVersion = '0.1.0' }

foreach ($value in @($Instance, $MinecraftVersion)) {
    if ($value -notmatch '^[A-Za-z0-9._-]+$') {
        throw "Instance and MinecraftVersion may only contain letters, digits, dot, underscore, and hyphen: $value"
    }
}
if (-not $Artifact) { $Artifact = "$Instance-$MinecraftVersion" }
if ($Artifact -notmatch '^[A-Za-z0-9._-]+$') {
    throw 'Artifact may only contain letters, digits, dot, underscore, and hyphen.'
}

$manifest = Get-Content $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
$existing = @($manifest.packs | Where-Object {
    $_.instance -eq $Instance -and $_.version -eq $MinecraftVersion
})
if ($existing) { throw "Pack target already exists: $Instance/$MinecraftVersion" }

$relativePath = "packwiz/$Instance/$MinecraftVersion"
$packDirectory = Join-Path $repoRoot $relativePath
if (Test-Path -LiteralPath $packDirectory) { throw "Target directory already exists: $relativePath" }

New-Item -ItemType Directory -Path $packDirectory | Out-Null
$packToml = @"
name = "$Name"
author = "$Author"
version = "$PackVersion"
pack-format = "packwiz:1.1.0"

[index]
file = "index.toml"
hash-format = "sha256"
hash = "0000000000000000000000000000000000000000000000000000000000000000"

[versions]
fabric = "$FabricVersion"
minecraft = "$MinecraftVersion"
"@
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $packDirectory 'pack.toml'), $packToml, $utf8)
[System.IO.File]::WriteAllText((Join-Path $packDirectory 'index.toml'), 'hash-format = "sha256"' + "`n`n" + 'files = []' + "`n", $utf8)

$entry = [pscustomobject][ordered]@{
    instance = $Instance
    version = $MinecraftVersion
    path = $relativePath
    artifact = $Artifact
}
$manifest.packs = @($manifest.packs) + $entry
if ($SetDefault -or -not $manifest.default) {
    $manifest.default = [pscustomobject][ordered]@{ instance = $Instance; version = $MinecraftVersion }
}
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5) + "`n", $utf8)

Write-Output "✓ 已创建 $Instance/$MinecraftVersion → $relativePath"
Write-Output "下一步：.\scripts\pack.ps1 refresh -Instance $Instance -Version $MinecraftVersion"

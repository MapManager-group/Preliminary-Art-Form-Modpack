#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Instance,

    [Parameter(Mandatory)]
    [string]$ImportMrpack,

    [string]$MinecraftVersion,
    [string]$FabricVersion,
    [string]$Name,
    [string]$PackVersion,
    [string]$Author = 'Your Name',
    [string]$Artifact,
    [switch]$SetDefault,

    [ValidateSet('client', 'server')]
    [string]$OverrideEnvironment,

    [switch]$SkipUnresolvedEmbeddedFiles,
    [int]$MaxExpandedSizeMB = 2048
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path
$manifestPath = Join-Path $repoRoot 'packwiz/instances.json'
$sourcePath = (Resolve-Path -LiteralPath $ImportMrpack).Path
$utf8 = [System.Text.UTF8Encoding]::new($false)
$manifestOriginal = [System.IO.File]::ReadAllBytes($manifestPath)
$packDirectory = $null
$reportPath = $null
$manifestChanged = $false

function ConvertTo-TomlString([string]$Value) {
    if ($null -eq $Value) { return '' }
    return $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n')
}

function Get-SafeRelativePath([string]$Path) {
    $normalized = $Path.Replace('\', '/').TrimStart('/')
    if (-not $normalized -or $normalized.IndexOf([char]0) -ge 0 -or $normalized -match '(^|/)\.\.(/|$)' -or $normalized -match '^[A-Za-z]:') {
        throw "Unsafe path in mrpack: $Path"
    }
    return $normalized
}

function Get-PackwizSide($Environment) {
    if ($Environment) {
        $client = [string]$Environment.client
        $server = [string]$Environment.server
        if ($server -eq 'unsupported' -and $client -ne 'unsupported') { return 'client' }
        if ($client -eq 'unsupported' -and $server -ne 'unsupported') { return 'server' }
    }
    return 'both'
}

function Get-VersionSide([string]$Environment) {
    if ($Environment -in @('client_only', 'client_only_server_optional', 'singleplayer_only')) { return 'client' }
    if ($Environment -in @('server_only', 'server_only_client_optional', 'dedicated_server_only')) { return 'server' }
    return 'both'
}

function New-Environment([string]$Side) {
    switch ($Side) {
        'client' { return [pscustomobject]@{ client = 'required'; server = 'unsupported' } }
        'server' { return [pscustomobject]@{ client = 'unsupported'; server = 'required' } }
        default { return [pscustomobject]@{ client = 'required'; server = 'required' } }
    }
}

function Get-EntrySha1($Entry) {
    $stream = $Entry.Open()
    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    try {
        $hashBytes = $sha1.ComputeHash($stream)
        return [Convert]::ToHexString($hashBytes).ToLowerInvariant()
    }
    finally {
        $sha1.Dispose()
        $stream.Dispose()
    }
}

function Resolve-ModrinthFile($Entry, [string]$RelativePath, [string]$SideOverride) {
    $sha1 = Get-EntrySha1 $Entry
    try {
        $version = Invoke-RestMethod -Uri "https://api.modrinth.com/v2/version_file/$sha1`?algorithm=sha1" -UserAgent 'DB-Packwiz-Example-Pack/1.0'
    }
    catch {
        $statusCode = $null
        if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
        if ($statusCode -eq 404) { return $null }
        throw "Modrinth hash lookup failed for $RelativePath`: $($_.Exception.Message)"
    }

    $matchedFile = @($version.files | Where-Object { $_.hashes.sha1 -eq $sha1 }) | Select-Object -First 1
    if (-not $matchedFile) { return $null }
    $side = if ($SideOverride) { $SideOverride } else { Get-VersionSide ([string]$version.environment) }
    return [pscustomobject]@{
        path = $RelativePath
        hashes = [pscustomobject]@{ sha1 = $sha1; sha512 = [string]$matchedFile.hashes.sha512 }
        env = New-Environment $side
        downloads = @([string]$matchedFile.url)
        projectId = [string]$version.project_id
        versionId = [string]$version.id
        displayName = [string]$version.name
    }
}

function Write-PackwizMetadata($File, [string]$ProjectId, [string]$VersionId, [string]$DisplayName) {
    $relativePath = Get-SafeRelativePath ([string]$File.path)
    $pathParts = $relativePath.Split('/')
    if ($pathParts.Count -lt 2) { throw "External file must be inside a meta-folder: $relativePath" }
    $filename = $pathParts[-1]
    $folder = ($pathParts[0..($pathParts.Count - 2)] -join '/')
    $metadataDirectory = Join-Path $packDirectory $folder
    New-Item -ItemType Directory -Force -Path $metadataDirectory | Out-Null

    $slugBase = if ($ProjectId) { $ProjectId } else { [System.IO.Path]::GetFileNameWithoutExtension($filename) }
    $slugBase = ($slugBase -replace '[^A-Za-z0-9._-]', '-').Trim('-')
    if (-not $slugBase) { $slugBase = 'imported-file' }
    $metadataPath = Join-Path $metadataDirectory "$slugBase.pw.toml"
    $suffix = 2
    while ($script:metadataPaths.ContainsKey($metadataPath)) {
        $metadataPath = Join-Path $metadataDirectory "$slugBase-$suffix.pw.toml"
        $suffix++
    }
    $script:metadataPaths[$metadataPath] = $true

    $downloadUrl = [string]@($File.downloads)[0]
    if (-not $downloadUrl) { throw "No download URL for $relativePath" }
    $hashFormat = if ($File.hashes.sha512) { 'sha512' } elseif ($File.hashes.sha1) { 'sha1' } else { $null }
    if (-not $hashFormat) { throw "No supported hash for $relativePath" }
    $hash = [string]$File.hashes.$hashFormat
    $side = Get-PackwizSide $File.env
    $entryName = if ($DisplayName) { $DisplayName } else { [System.IO.Path]::GetFileNameWithoutExtension($filename) }

    $lines = @(
        "name = `"$(ConvertTo-TomlString $entryName)`""
        "filename = `"$(ConvertTo-TomlString $filename)`""
        "side = `"$side`""
        ''
        '[download]'
        "url = `"$(ConvertTo-TomlString $downloadUrl)`""
        "hash-format = `"$hashFormat`""
        "hash = `"$hash`""
    )
    if ($ProjectId -and $VersionId) {
        $lines += @(
            ''
            '[update]'
            '[update.modrinth]'
            "mod-id = `"$(ConvertTo-TomlString $ProjectId)`""
            "version = `"$(ConvertTo-TomlString $VersionId)`""
        )
    }
    [System.IO.File]::WriteAllText($metadataPath, ($lines -join "`n") + "`n", $utf8)
}

if ([System.IO.Path]::GetExtension($sourcePath) -ne '.mrpack') { throw "Import file must use the .mrpack extension: $sourcePath" }
if ($Instance -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid instance id: $Instance" }
if ($MaxExpandedSizeMB -lt 1) { throw 'MaxExpandedSizeMB must be greater than zero.' }
if (-not $OverrideEnvironment) {
    $OverrideEnvironment = if ($Instance -match 'server') { 'server' } else { 'client' }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($sourcePath)
try {
    $indexEntry = $zip.GetEntry('modrinth.index.json')
    if (-not $indexEntry) { throw 'The mrpack does not contain modrinth.index.json.' }
    if ($indexEntry.Length -gt 16MB) { throw 'modrinth.index.json is unexpectedly large.' }
    $reader = [System.IO.StreamReader]::new($indexEntry.Open(), [System.Text.Encoding]::UTF8, $true)
    try { $modrinthIndex = $reader.ReadToEnd() | ConvertFrom-Json }
    finally { $reader.Dispose() }

    if ([int]$modrinthIndex.formatVersion -ne 1 -or $modrinthIndex.game -ne 'minecraft') {
        throw 'Only Minecraft Modrinth pack formatVersion 1 is supported.'
    }

    if (-not $MinecraftVersion) { $MinecraftVersion = [string]$modrinthIndex.dependencies.minecraft }
    if (-not $MinecraftVersion) { throw 'Minecraft version is missing from the mrpack dependencies.' }
    if ($MinecraftVersion -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid Minecraft version: $MinecraftVersion" }
    if (-not $Name) { $Name = [string]$modrinthIndex.name }
    if (-not $Name) { $Name = "Imported Pack - $Instance" }
    if (-not $PackVersion) { $PackVersion = [string]$modrinthIndex.versionId }
    if (-not $PackVersion) { $PackVersion = '0.1.0' }
    if (-not $Artifact) { $Artifact = "$Instance-$MinecraftVersion" }
    if ($Artifact -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid artifact name: $Artifact" }

    $manifest = Get-Content $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    if (@($manifest.packs | Where-Object { $_.instance -eq $Instance -and $_.version -eq $MinecraftVersion })) {
        throw "Pack target already exists: $Instance/$MinecraftVersion"
    }
    $relativePackPath = "packwiz/$Instance/$MinecraftVersion"
    $packDirectory = Join-Path $repoRoot $relativePackPath
    if (Test-Path -LiteralPath $packDirectory) { throw "Target directory already exists: $relativePackPath" }

    $dependencyProperties = @($modrinthIndex.dependencies.PSObject.Properties)
    $versionLines = @()
    $loaderMap = [ordered]@{
        'fabric-loader' = 'fabric'
        'quilt-loader' = 'quilt'
        'forge' = 'forge'
        'neoforge' = 'neoforge'
    }
    foreach ($loader in $loaderMap.GetEnumerator()) {
        $loaderVersion = [string]($dependencyProperties | Where-Object Name -eq $loader.Key | Select-Object -ExpandProperty Value -First 1)
        if ($loader.Key -eq 'fabric-loader' -and $FabricVersion) { $loaderVersion = $FabricVersion }
        if ($loaderVersion) { $versionLines += "$($loader.Value) = `"$(ConvertTo-TomlString $loaderVersion)`"" }
    }
    if (-not $versionLines) {
        if ($FabricVersion) { $versionLines += "fabric = `"$(ConvertTo-TomlString $FabricVersion)`"" }
        else { throw 'No supported mod loader was found in the mrpack dependencies.' }
    }
    $versionLines += "minecraft = `"$(ConvertTo-TomlString $MinecraftVersion)`""

    New-Item -ItemType Directory -Path $packDirectory | Out-Null
    $packTomlLines = @(
        "name = `"$(ConvertTo-TomlString $Name)`""
        "author = `"$(ConvertTo-TomlString $Author)`""
        "version = `"$(ConvertTo-TomlString $PackVersion)`""
        'pack-format = "packwiz:1.1.0"'
        ''
        '[index]'
        'file = "index.toml"'
        'hash-format = "sha256"'
        'hash = "0000000000000000000000000000000000000000000000000000000000000000"'
        ''
        '[versions]'
    ) + $versionLines
    [System.IO.File]::WriteAllText((Join-Path $packDirectory 'pack.toml'), ($packTomlLines -join "`n") + "`n", $utf8)
    [System.IO.File]::WriteAllText((Join-Path $packDirectory 'index.toml'), "hash-format = `"sha256`"`n`nfiles = []`n", $utf8)

    $script:metadataPaths = @{}
    $importedExternal = 0
    foreach ($file in @($modrinthIndex.files)) {
        $url = [string]@($file.downloads)[0]
        $projectId = $null
        $versionId = $null
        if ($url -match '^https://cdn\.modrinth\.com/data/([^/]+)/versions/([^/]+)/') {
            $projectId = [System.Uri]::UnescapeDataString($Matches[1])
            $versionId = [System.Uri]::UnescapeDataString($Matches[2])
        }
        Write-PackwizMetadata -File $file -ProjectId $projectId -VersionId $versionId
        $importedExternal++
    }

    $resolvedEmbedded = @()
    $skippedEmbedded = @()
    $ignoredEnvironmentOverrides = @()
    $allowedPrefixes = @('overrides/', "$OverrideEnvironment-overrides/")
    $oppositeEnvironment = if ($OverrideEnvironment -eq 'client') { 'server' } else { 'client' }
    $oppositePrefix = "$oppositeEnvironment-overrides/"
    $expandedBytes = 0L
    foreach ($entry in $zip.Entries) {
        $entryPath = $entry.FullName.Replace('\', '/')
        if ($entryPath.StartsWith($oppositePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and -not $entryPath.EndsWith('/')) {
            $ignoredEnvironmentOverrides += $entryPath
            continue
        }
        $prefix = $allowedPrefixes | Where-Object { $entryPath.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
        if (-not $prefix -or $entryPath.EndsWith('/')) { continue }

        $relativePath = Get-SafeRelativePath $entryPath.Substring($prefix.Length)
        $isManagedFolderFile = $relativePath -match '^(mods|resourcepacks|shaderpacks)/[^/]+\.(jar|zip)$'
        if ($isManagedFolderFile) {
            $sideOverride = if ($prefix -eq 'client-overrides/') { 'client' } elseif ($prefix -eq 'server-overrides/') { 'server' } else { $null }
            $resolved = Resolve-ModrinthFile -Entry $entry -RelativePath $relativePath -SideOverride $sideOverride
            if ($resolved) {
                Write-PackwizMetadata -File $resolved -ProjectId $resolved.projectId -VersionId $resolved.versionId -DisplayName $resolved.displayName
                $resolvedEmbedded += $entryPath
                continue
            }
            if ($SkipUnresolvedEmbeddedFiles) {
                $skippedEmbedded += $entryPath
                Write-Warning "跳过无法解析为 Modrinth 元数据的嵌入文件: $entryPath"
                continue
            }
            throw "Embedded dependency cannot be resolved on Modrinth: $entryPath. Re-run with -SkipUnresolvedEmbeddedFiles to omit it and record the omission."
        }

        $expandedBytes += [long]$entry.Length
        if ($expandedBytes -gt ([long]$MaxExpandedSizeMB * 1MB)) {
            throw "Override extraction exceeds MaxExpandedSizeMB ($MaxExpandedSizeMB MB)."
        }
        $destination = [System.IO.Path]::GetFullPath((Join-Path $packDirectory $relativePath))
        $packPrefix = $packDirectory.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
        if (-not $destination.StartsWith($packPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Archive entry escapes the pack directory: $entryPath"
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
    }

    $packwizExecutable = Join-Path $repoRoot 'packwiz.exe'
    if (-not (Test-Path -LiteralPath $packwizExecutable -PathType Leaf)) {
        throw 'Import requires packwiz.exe in the repository root so the generated project can be refreshed before registration.'
    }
    $cacheDirectory = Join-Path $repoRoot '.packwiz-cache'
    New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
    Push-Location $packDirectory
    try {
        & $packwizExecutable --cache $cacheDirectory refresh
        if ($LASTEXITCODE -ne 0) { throw "packwiz refresh failed with exit code $LASTEXITCODE" }
        & $packwizExecutable --cache $cacheDirectory list | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "packwiz list failed with exit code $LASTEXITCODE" }
    }
    finally { Pop-Location }

    $reportDirectory = Join-Path $repoRoot 'import-reports'
    New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
    $reportPath = Join-Path $reportDirectory "$Instance-$MinecraftVersion.json"
    $report = [ordered]@{
        source = [System.IO.Path]::GetFileName($sourcePath)
        target = "$Instance/$MinecraftVersion"
        overrideEnvironment = $OverrideEnvironment
        importedExternalFiles = $importedExternal
        resolvedEmbeddedFiles = @($resolvedEmbedded)
        skippedEmbeddedFiles = @($skippedEmbedded)
        ignoredEnvironmentOverrides = @($ignoredEnvironmentOverrides)
    }
    [System.IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 5) + "`n", $utf8)

    $manifest.packs = @($manifest.packs) + [pscustomobject][ordered]@{
        instance = $Instance
        version = $MinecraftVersion
        path = $relativePackPath
        artifact = $Artifact
    }
    if ($SetDefault -or -not $manifest.default) {
        $manifest.default = [pscustomobject][ordered]@{ instance = $Instance; version = $MinecraftVersion }
    }
    $manifestChanged = $true
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5) + "`n", $utf8)

    Write-Output "✓ 已导入 $Instance/$MinecraftVersion → $relativePackPath"
    Write-Output "✓ 外部文件: $importedExternal；解析嵌入文件: $($resolvedEmbedded.Count)；跳过: $($skippedEmbedded.Count)"
    Write-Output "✓ 导入报告: $([System.IO.Path]::GetRelativePath($repoRoot, $reportPath))"
}
catch {
    if ($manifestChanged) { [System.IO.File]::WriteAllBytes($manifestPath, $manifestOriginal) }
    if ($packDirectory -and (Test-Path -LiteralPath $packDirectory)) {
        $packRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'packwiz'))
        $resolvedPack = [System.IO.Path]::GetFullPath($packDirectory)
        $packPrefix = $packRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
        if (-not $resolvedPack.StartsWith($packPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Import failed and rollback refused an unsafe path: $resolvedPack. Original error: $($_.Exception.Message)"
        }
        Remove-Item -LiteralPath $resolvedPack -Recurse -Force
        $instanceDirectory = Split-Path -Parent $resolvedPack
        if (
            $instanceDirectory.StartsWith($packPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
            (Test-Path -LiteralPath $instanceDirectory) -and
            -not (Get-ChildItem -LiteralPath $instanceDirectory -Force)
        ) {
            Remove-Item -LiteralPath $instanceDirectory -Force
        }
    }
    if ($reportPath -and (Test-Path -LiteralPath $reportPath)) { Remove-Item -LiteralPath $reportPath -Force }
    throw
}
finally {
    $zip.Dispose()
}

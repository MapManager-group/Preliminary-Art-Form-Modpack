#requires -Version 7.0

<#
.SYNOPSIS
    Packwiz 多实例、多版本整合包开发 CLI

.DESCRIPTION
    统一的 packwiz 包装器，自动烘焙公共参数，并从 packwiz/instances.json
    解析实例与 Minecraft 版本。

.PARAMETER Command
    子命令: add, remove, update, pin, unpin, list, refresh, validate, build

.PARAMETER Version
    Minecraft 版本标识（如 1.21.1）。

.PARAMETER Instance
    整合包实例标识（如 client 或 server）。

.PARAMETER Folder
    目标 meta-folder: mods (默认), resourcepacks, shaderpacks

.PARAMETER UpdateChannel
    更新渠道: release (仅正式版，默认), prerelease (包含 alpha/beta)

.EXAMPLE
    .\scripts\pack.ps1 add sodium -Instance client -Version 1.21.1
    .\scripts\pack.ps1 add -Folder shaderpacks complementary-reimagined
    .\scripts\pack.ps1 remove sodium
    .\scripts\pack.ps1 update --all
    .\scripts\pack.ps1 update sodium
    .\scripts\pack.ps1 update -UpdateChannel prerelease --all
    .\scripts\pack.ps1 list
    .\scripts\pack.ps1 refresh
    .\scripts\pack.ps1 validate
    .\scripts\pack.ps1 build
    .\scripts\pack.ps1                        # 交互菜单
    .\scripts\pack.ps1 -- <任意 packwiz 参数>  # 透传
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('add', 'remove', 'update', 'pin', 'unpin', 'list', 'refresh', 'validate', 'build', 'help', '--')]
    [string]$Command,

    [Parameter()]
    [string]$Version,

    [Parameter()]
    [string]$Instance,

    [Parameter()]
    [ValidateSet('mods', 'resourcepacks', 'shaderpacks')]
    [string]$Folder = 'mods',

    [Parameter()]
    [ValidateSet('modrinth', 'curseforge')]
    [string]$Source = 'modrinth',

    [Parameter()]
    [ValidateSet('release', 'prerelease')]
    [string]$UpdateChannel = 'release',

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$script:PromptForbiddenCleanup = [Environment]::UserInteractive -and -not $env:CI

# packwiz 会输出 UTF-8 项目名称；显式设置控制台编码以正确显示中文名称。
try {
    $Utf8Encoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = $Utf8Encoding
    [Console]::OutputEncoding = $Utf8Encoding
    $OutputEncoding = $Utf8Encoding
}
catch {
    # 非交互宿主可能不支持设置控制台编码，保留宿主默认行为。
}

# ── 路径解析 ──────────────────────────────────────────────
$ScriptDir  = $PSScriptRoot
$RepoRoot   = Resolve-Path "$ScriptDir/.." | Select-Object -ExpandProperty Path
$CacheDir   = Join-Path $RepoRoot '.packwiz-cache'
$PackwizBin = Join-Path $RepoRoot 'packwiz.exe'

# ── 颜色常量 ──────────────────────────────────────────────
$Cyan    = [ConsoleColor]::Cyan
$Green   = [ConsoleColor]::Green
$Yellow  = [ConsoleColor]::Yellow
$Red     = [ConsoleColor]::Red
$Magenta = [ConsoleColor]::Magenta
$White   = [ConsoleColor]::White
$Gray    = [ConsoleColor]::DarkGray

function Write-Color($Text, $Color = $White, [switch]$NoNewline) {
    if ($NoNewline) { Write-Host $Text -ForegroundColor $Color -NoNewline }
    else            { Write-Host $Text -ForegroundColor $Color }
}

# ── 实例与版本探测 ────────────────────────────────────────

function Get-PackTargets {
    $manifestPath = Join-Path $RepoRoot 'packwiz' 'instances.json'
    if (-not (Test-Path $manifestPath -PathType Leaf)) {
        throw 'Missing packwiz/instances.json'
    }

    $manifest = Get-Content $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    $targets = @($manifest.packs)
    if (-not $targets) { throw 'packwiz/instances.json must contain a non-empty packs array' }

    $seenKeys = @{}
    $seenPaths = @{}
    foreach ($target in $targets) {
        foreach ($field in @('instance', 'version', 'path', 'artifact')) {
            if (-not $target.$field) { throw "Missing '$field' in packwiz/instances.json" }
        }

        $key = "$($target.instance)/$($target.version)"
        if ($seenKeys.ContainsKey($key)) { throw "Duplicate pack target: $key" }
        $seenKeys[$key] = $true

        $fullPath = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $target.path))
        $repoPrefix = $RepoRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
        if (-not $fullPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Pack path must be inside the repository: $($target.path)"
        }
        if ($seenPaths.ContainsKey($fullPath)) { throw "Duplicate pack path: $($target.path)" }
        $seenPaths[$fullPath] = $true
        if (-not (Test-Path (Join-Path $fullPath 'pack.toml') -PathType Leaf)) {
            throw "pack.toml not found for $key at $($target.path)"
        }

        $target | Add-Member -NotePropertyName FullPath -NotePropertyValue $fullPath -Force
        $target | Add-Member -NotePropertyName Key -NotePropertyValue $key -Force
    }

    $default = $null
    if ($manifest.default) {
        $default = $targets | Where-Object {
            $_.instance -eq $manifest.default.instance -and $_.version -eq $manifest.default.version
        } | Select-Object -First 1
        if (-not $default) { throw 'The default target in packwiz/instances.json does not exist in packs' }
    }

    return @{ Targets = @($targets); Default = $default }
}

function Select-PackTarget($Targets, $DefaultTarget) {
    while ($true) {
        try { Clear-Host } catch { }
        Write-Color '  📦 Packwiz Workspace CLI' $Cyan
        Write-Color '  ═══════════════════════════════════════════════' $Gray
        Write-Color '  请选择要管理的实例与 Minecraft 版本：' $Cyan
        Write-Color ''

        for ($i = 0; $i -lt $Targets.Count; $i++) {
            $target = $Targets[$i]
            $marker = if ($DefaultTarget -and $target.Key -eq $DefaultTarget.Key) { '（默认）' } else { '' }
            Write-Color "  [$($i + 1)] $($target.Key) $marker" $White -NoNewline
            Write-Color "  ← $($target.path)" $Gray
        }
        Write-Color ''

        $hint = if ($DefaultTarget) {
            "输入编号或 instance/version（直接回车使用默认：$($DefaultTarget.Key)；0=退出）"
        } else {
            '输入编号或 instance/version（0=退出）'
        }
        $selection = Read-Host $hint
        if ($selection -eq '0') { return $null }
        if (-not $selection -and $DefaultTarget) { return $DefaultTarget }
        if ($selection -match '^\d+$') {
            $index = [int]$selection - 1
            if ($index -ge 0 -and $index -lt $Targets.Count) { return $Targets[$index] }
        }
        $match = $Targets | Where-Object { $_.Key -eq $selection } | Select-Object -First 1
        if ($match) { return $match }
        Write-Color '❓ 无效目标，请重新选择。' $Red
    }
}

function Resolve-PackTarget([string]$RequestedInstance, [string]$RequestedVersion, [switch]$PromptForSelection) {
    $catalog = Get-PackTargets
    $all = @($catalog.Targets)
    $matches = @($all | Where-Object {
        (-not $RequestedInstance -or $_.instance -eq $RequestedInstance) -and
        (-not $RequestedVersion -or $_.version -eq $RequestedVersion)
    })

    if (($RequestedInstance -or $RequestedVersion) -and -not $matches) {
        throw "Unknown pack target. Requested instance='$RequestedInstance', version='$RequestedVersion'. Available: $($all.Key -join ', ')"
    }
    if ($matches.Count -eq 1) { return $matches[0] }

    $defaultMatch = if ($catalog.Default -and $catalog.Default.Key -in $matches.Key) { $catalog.Default } else { $null }
    if ($PromptForSelection) {
        return Select-PackTarget $matches $defaultMatch
    }

    if ($defaultMatch) { return $defaultMatch }
    throw "Multiple pack targets matched ($($matches.Key -join ', ')). Use -Instance and -Version or configure default in packwiz/instances.json"
}

function Get-PackInfo($VersionDir) {
    $packToml = Join-Path $VersionDir 'pack.toml'
    $content  = Get-Content $packToml -Raw

    $name    = if ($content -match 'name\s*=\s*"([^"]+)"')    { $Matches[1] } else { '???' }
    $ver     = if ($content -match 'version\s*=\s*"([^"]+)"') { $Matches[1] } else { '???' }
    $mc      = if ($content -match 'minecraft\s*=\s*"([^"]+)"') { $Matches[1] } else { '???' }
    $fabric  = if ($content -match 'fabric\s*=\s*"([^"]+)"')  { $Matches[1] } else { '???' }

    return @{ Name = $name; Version = $ver; Minecraft = $mc; Fabric = $fabric }
}

function Get-PackEntries {
    $entries = @()
    $metaFolders = @('mods', 'resourcepacks', 'shaderpacks')
    foreach ($mf in $metaFolders) {
        $folderPath = Join-Path $PackDir $mf
        if (-not (Test-Path $folderPath)) { continue }
        Get-ChildItem $folderPath -Filter '*.pw.toml' -File | ForEach-Object {
            # .pw.toml 是双扩展名，用正则去掉完整后缀，避免得到 xxx.pw
            $slug = $_.Name -replace '\.pw\.toml$', ''
            $ct = (Get-Content $_.FullName -TotalCount 3) -join "`n"
            $nm = if ($ct -match 'name\s*=\s*"([^"]+)"') { $Matches[1] } else { $slug }
            $entries += @{ Slug = $slug; Name = $nm; Folder = $mf; Path = $_.FullName }
        }
    }
    return $entries
}

function Get-ModrinthEntries {
    @(Get-PackEntries | Where-Object {
        (Get-Content $_.Path -Raw -Encoding utf8) -match '(?m)^\[update\.modrinth\]'
    })
}

function Get-UpdateCompatibility {
    $packToml = Get-Content (Join-Path $PackDir 'pack.toml') -Raw
    $minecraftVersions = @()
    $minecraftMatch = [regex]::Match($packToml, '(?m)^minecraft\s*=\s*"([^"]+)"\s*$')
    if ($minecraftMatch.Success) { $minecraftVersions += $minecraftMatch.Groups[1].Value }

    $acceptableMatch = [regex]::Match($packToml, '(?m)^acceptable-game-versions\s*=\s*(\[[^\r\n]*\])\s*$')
    if ($acceptableMatch.Success) {
        try { $minecraftVersions += @($acceptableMatch.Groups[1].Value | ConvertFrom-Json) }
        catch { throw 'pack.toml 中的 acceptable-game-versions 格式无效' }
    }

    $packLoaders = @()
    foreach ($loader in @('fabric', 'quilt', 'forge', 'neoforge')) {
        if ($packToml -match "(?m)^$loader\s*=\s*`"[^`"]+`"\s*$") { $packLoaders += $loader }
    }
    $loaders = @($packLoaders) + @('canvas', 'iris', 'optifine', 'vanilla', 'minecraft')

    return @{
        MinecraftVersions = @($minecraftVersions | Select-Object -Unique)
        PackLoaders = @($packLoaders | Select-Object -Unique)
        Loaders = @($loaders | Select-Object -Unique)
    }
}

function Get-LatestModrinthRelease {
    param(
        [hashtable]$Entry,
        [hashtable]$Compatibility
    )

    $metadata = Get-Content $Entry.Path -Raw -Encoding utf8
    $projectMatch = [regex]::Match($metadata, '(?m)^mod-id\s*=\s*"([^"]+)"\s*$')
    $versionMatch = [regex]::Match($metadata, '(?m)^version\s*=\s*"([^"]+)"\s*$')
    if (-not $projectMatch.Success -or -not $versionMatch.Success) {
        throw "Modrinth 更新元数据不完整: $($Entry.Path)"
    }

    $projectId = $projectMatch.Groups[1].Value
    $headers = @{ 'User-Agent' = 'DB-Packwiz-Example-Pack/1.0' }
    $versionsResponse = Invoke-RestMethod -Uri "https://api.modrinth.com/v2/project/$projectId/version" -Headers $headers
    $compatibleReleases = @(foreach ($version in $versionsResponse) {
        if (
            $version.version_type -eq 'release' -and
            @($version.game_versions | Where-Object { $_ -in $Compatibility.MinecraftVersions }).Count -gt 0 -and
            @($version.loaders | Where-Object { $_ -in $Compatibility.Loaders }).Count -gt 0
        ) {
            $version
        }
    })

    $latest = $compatibleReleases | Sort-Object { [datetimeoffset]$_.date_published } -Descending | Select-Object -First 1
    if (-not $latest) { return $null }

    return @{
        ProjectId = $projectId
        CurrentVersionId = $versionMatch.Groups[1].Value
        VersionId = $latest.id
        VersionNumber = $latest.version_number
    }
}

function Get-CurseForgeMetadata {
    param([hashtable]$Entry)

    $metadata = Get-Content $Entry.Path -Raw -Encoding utf8
    $projectMatch = [regex]::Match($metadata, '(?m)^project-id\s*=\s*(\d+)\s*$')
    $fileMatch = [regex]::Match($metadata, '(?m)^file-id\s*=\s*(\d+)\s*$')
    if (-not $projectMatch.Success -or -not $fileMatch.Success) {
        throw "CurseForge 更新元数据不完整: $($Entry.Path)"
    }

    return @{
        ProjectId = [uint64]$projectMatch.Groups[1].Value
        FileId = [uint64]$fileMatch.Groups[1].Value
    }
}

function Get-LatestCurseForgeRelease {
    param(
        [hashtable]$Entry,
        [hashtable]$Compatibility
    )

    $current = Get-CurseForgeMetadata $Entry
    $headers = @{ 'User-Agent' = 'DB-Packwiz-Example-Pack/1.0' }
    $project = Invoke-RestMethod -Uri "https://api.cfwidget.com/$($current.ProjectId)" -Headers $headers
    $candidates = @(foreach ($file in @($project.files)) {
        $versionTags = @($file.versions | ForEach-Object { "$_".ToLowerInvariant() })
        $minecraftMatches = "$($file.version)" -in $Compatibility.MinecraftVersions
        $loaderMatches = $Entry.Folder -ne 'mods' -or @(
            $Compatibility.PackLoaders | Where-Object { $_.ToLowerInvariant() -in $versionTags }
        ).Count -gt 0

        if ($file.type -eq 'release' -and $minecraftMatches -and $loaderMatches) {
            $file
        }
    })

    $latest = $candidates | Sort-Object { [datetimeoffset]$_.uploaded_at } -Descending | Select-Object -First 1
    if (-not $latest) { return $null }

    return @{
        ProjectId = $current.ProjectId
        CurrentFileId = $current.FileId
        FileId = [uint64]$latest.id
        DisplayName = $latest.display
        FileName = $latest.name
    }
}

function Get-CurseForgeFileId {
    param([string]$MetadataPath)

    $metadata = Get-Content $MetadataPath -Raw -Encoding utf8
    $fileMatch = [regex]::Match($metadata, '(?m)^file-id\s*=\s*(\d+)\s*$')
    if (-not $fileMatch.Success) { throw "CurseForge file-id 缺失: $MetadataPath" }
    return [uint64]$fileMatch.Groups[1].Value
}

# ── packwiz 调用 ──────────────────────────────────────────

function Assert-Packwiz {
    if (-not (Test-Path $PackwizBin -PathType Leaf)) {
        throw "packwiz.exe not found in repo root: $PackwizBin"
    }
}

function Invoke-Packwiz([scriptblock]$Action) {
    Assert-Packwiz
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

    Push-Location $PackDir
    try { & $Action }
    finally { Pop-Location }
}

function Invoke-PackwizRefresh {
    & (Join-Path $ScriptDir 'normalize-pack-line-endings.ps1') -PackDirectory $PackDir
    Write-Color '↻ 正在刷新 index.toml ...' $Cyan
    Invoke-Packwiz {
        $pArgs = @('--cache', $CacheDir, 'refresh')
        & $PackwizBin @pArgs
        if ($LASTEXITCODE -ne 0) { throw "packwiz refresh failed (exit $LASTEXITCODE)" }
    }
    Write-Color '✓ index.toml 已刷新' $Green
}

# ── 子命令实现 ────────────────────────────────────────────

function Invoke-Add {
    param(
        [string]$TargetFolder = $Folder,
        [ValidateSet('modrinth', 'curseforge')]
        [string]$TargetSource = $Source
    )

    # CLI: $Rest 来自命令行参数；菜单: $global:Rest 由交互流程写入
    $targets = if ($Rest) { @($Rest) } else { @($global:Rest) }
    $slug = $targets -join ' '
    if (-not $slug) { throw "add 需要指定 $TargetSource slug 或 URL" }

    $sourceLabel = if ($TargetSource -eq 'curseforge') { 'CurseForge' } else { 'Modrinth' }
    Write-Color "🔍 从 $sourceLabel 搜索: $slug" $Cyan
    Write-Color "   meta-folder: $TargetFolder" $Gray
    if ($TargetSource -eq 'curseforge') {
        Write-Color '⚠ CurseForge 依赖导出为 .mrpack 时会内嵌 JAR，请确认再分发许可。' $Yellow
    }

    Invoke-Packwiz {
        $pArgs = @(
            '--cache', $CacheDir,
            $TargetSource, 'add',
            '--meta-folder', $TargetFolder,
            '--meta-folder-base', '.'
        ) + $targets

        & $PackwizBin @pArgs
        if ($LASTEXITCODE -ne 0) { throw "packwiz $TargetSource add failed (exit $LASTEXITCODE)" }
    }

    Write-Color "✅ $slug 已添加至 $TargetFolder/" $Green
    Invoke-PackwizRefresh
    Invoke-Validate

    # 建议提交信息使用 packwiz 写入的项目显示名，而不是用户输入的 URL。
    $commitTarget = $slug
    if ($targets.Count -eq 1) {
        $entrySlug = switch ($TargetSource) {
            'curseforge' {
                if ($targets[0] -match 'curseforge\.com/minecraft/[^/]+/([^/?#]+)') { $Matches[1] }
                else { $targets[0] }
            }
            default {
                if ($targets[0] -match 'modrinth\.com/(?:mod|resourcepack|shader)/([^/?#]+)') { $Matches[1] }
                else { $targets[0] }
            }
        }
        $entry = Get-PackEntries | Where-Object {
            $_.Folder -eq $TargetFolder -and $_.Slug -eq $entrySlug
        } | Select-Object -First 1
        if ($entry) { $commitTarget = $entry.Name }
    }

    $scope = if ($TargetFolder -eq 'mods') { 'mod' } else { 'resource' }
    Write-Color "💡 建议提交: ✨ feat($scope): 从 $sourceLabel 添加 $commitTarget" $Magenta
}

function Invoke-Remove {
    $targets = if ($Rest) { @($Rest) } else { @($global:Rest) }
    $slug = $targets -join ' '
    if (-not $slug) { throw 'remove 需要指定 slug（.pw.toml 文件名）' }

    Write-Color "🗑 移除: $slug" $Yellow

    Invoke-Packwiz {
        $pArgs = @('--cache', $CacheDir, 'remove') + $targets
        & $PackwizBin @pArgs
        if ($LASTEXITCODE -ne 0) { throw "packwiz remove failed (exit $LASTEXITCODE)" }
    }

    Write-Color "✅ $slug 已移除" $Green
    Invoke-PackwizRefresh
    Invoke-Validate

    Write-Color "💡 建议提交: 🐛 fix(packwiz): remove $slug" $Magenta
}

function Invoke-PrereleaseUpdate {
    param([string[]]$Targets)

    Invoke-Packwiz {
        $pArgs = @('--cache', $CacheDir, 'update')
        if ($Targets -and $Targets -notcontains '--all') { $pArgs += $Targets }
        else { $pArgs += '--all' }
        & $PackwizBin @pArgs
        if ($LASTEXITCODE -ne 0) { throw "packwiz update failed (exit $LASTEXITCODE)" }
    }
}

function Invoke-ReleaseUpdate {
    param([string[]]$Targets)

    $allEntries = @(Get-PackEntries)
    $selectedEntries = if (-not $Targets -or $Targets -contains '--all') {
        $allEntries
    } else {
        @($Targets | ForEach-Object {
            $target = $_
            $entry = $allEntries | Where-Object { $_.Slug -eq $target } | Select-Object -First 1
            if (-not $entry) { throw "找不到依赖: $target" }
            $entry
        })
    }

    $compatibility = Get-UpdateCompatibility
    $updated = 0
    $unchanged = 0
    $skipped = 0
    $previewRoot = $null
    $previewPackDir = $null
    try {
        foreach ($entry in $selectedEntries) {
            $metadata = Get-Content $entry.Path -Raw -Encoding utf8
            if ($metadata -match '(?m)^pin\s*=\s*true\s*$') {
                Write-Color "  ⏭ $($entry.Name): 已固定版本" $Gray
                $skipped++
                continue
            }

            Write-Color "  • 检查 $($entry.Name)" $Gray
            if ($metadata -match '(?m)^\[update\.modrinth\]\s*$') {
                $release = Get-LatestModrinthRelease -Entry $entry -Compatibility $compatibility
                if (-not $release) {
                    Write-Color '    ⏭ 没有兼容的正式版' $Yellow
                    $skipped++
                    continue
                }
                if ($release.VersionId -eq $release.CurrentVersionId) {
                    $unchanged++
                    continue
                }

                Invoke-Packwiz {
                    $pArgs = @(
                        '--cache', $CacheDir,
                        '--yes',
                        'modrinth', 'add',
                        '--meta-folder', $entry.Folder,
                        '--meta-folder-base', '.',
                        '--project-id', $release.ProjectId,
                        '--version-id', $release.VersionId
                    )
                    & $PackwizBin @pArgs
                    if ($LASTEXITCODE -ne 0) { throw "packwiz modrinth add failed (exit $LASTEXITCODE)" }
                }
                Write-Color "    ↑ 已更新到 release $($release.VersionNumber)" $Green
                $updated++
                continue
            }

            if ($metadata -match '(?m)^\[update\.curseforge\]\s*$') {
                try {
                    $release = Get-LatestCurseForgeRelease -Entry $entry -Compatibility $compatibility
                    if (-not $release) {
                        Write-Color '    ⏭ 没有兼容的 CurseForge 正式版' $Yellow
                        $skipped++
                        continue
                    }
                    if ($release.FileId -eq $release.CurrentFileId) {
                        $unchanged++
                        continue
                    }

                    if (-not $previewPackDir) {
                        $tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
                        $previewRoot = Join-Path $tempBase "db-packwiz-preview-$([guid]::NewGuid().ToString('N'))"
                        $previewPackDir = Join-Path $previewRoot 'pack'
                        New-Item -ItemType Directory -Path $previewRoot | Out-Null
                        Copy-Item -LiteralPath $PackDir -Destination $previewPackDir -Recurse
                    }

                    $relativeMetadataPath = [System.IO.Path]::GetRelativePath($PackDir, $entry.Path)
                    $previewMetadataPath = Join-Path $previewPackDir $relativeMetadataPath
                    Push-Location $previewPackDir
                    try {
                        & $PackwizBin --cache $CacheDir update $entry.Slug | Out-Host
                        if ($LASTEXITCODE -ne 0) { throw "packwiz update preview failed (exit $LASTEXITCODE)" }
                    }
                    finally {
                        Pop-Location
                    }

                    $previewFileId = Get-CurseForgeFileId $previewMetadataPath
                    if ($previewFileId -ne $release.FileId) {
                        Write-Color "    ⏭ packwiz 候选文件 $previewFileId 不是最新 release $($release.FileId)，已安全跳过" $Yellow
                        $skipped++
                        continue
                    }

                    Invoke-Packwiz {
                        & $PackwizBin --cache $CacheDir update $entry.Slug
                        if ($LASTEXITCODE -ne 0) { throw "packwiz update failed (exit $LASTEXITCODE)" }
                    }
                    Write-Color "    ↑ 已更新到 CurseForge release $($release.DisplayName) (file $($release.FileId))" $Green
                    $updated++
                }
                catch {
                    Write-Color "    ⏭ CurseForge 正式版检查失败，已安全跳过: $($_.Exception.Message)" $Yellow
                    $skipped++
                }
                continue
            }

            Write-Color '    ⏭ 不支持的更新来源' $Yellow
            $skipped++
        }
    }
    finally {
        if ($previewRoot -and (Test-Path -LiteralPath $previewRoot)) {
            $resolvedPreview = (Resolve-Path -LiteralPath $previewRoot).Path
            $resolvedTempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
            if (
                (Split-Path -Parent $resolvedPreview) -ne $resolvedTempBase -or
                (Split-Path -Leaf $resolvedPreview) -notlike 'db-packwiz-preview-*'
            ) {
                throw "拒绝清理未验证的预览目录: $resolvedPreview"
            }
            Remove-Item -LiteralPath $resolvedPreview -Recurse -Force
        }
    }

    Write-Color "  正式版检查结果: 更新 $updated，已是最新 $unchanged，跳过 $skipped" $Gray
}

function Invoke-Update {
    $targets = if ($Rest) { @($Rest) } else { @($global:Rest) }
    $channelLabel = if ($UpdateChannel -eq 'release') { '仅正式版 (release)' } else { '包含测试版 (alpha/beta)' }
    Write-Color "🔍 检查更新: $channelLabel ..." $Cyan

    if ($UpdateChannel -eq 'release') { Invoke-ReleaseUpdate -Targets $targets }
    else { Invoke-PrereleaseUpdate -Targets $targets }

    Write-Color '✅ 更新完成' $Green
    Invoke-PackwizRefresh
    Invoke-Validate

    $scope = if ($targets) { @($targets)[0] } else { '--all' }
    Write-Color "💡 建议提交: ⬆️ chore(mod): update $scope" $Magenta
}

function Invoke-Pin {
    Write-Color '📌 固定版本（交互式选择）...' $Cyan
    Invoke-Packwiz {
        & $PackwizBin --cache $CacheDir pin
        if ($LASTEXITCODE -ne 0) { throw "packwiz pin failed (exit $LASTEXITCODE)" }
    }
    Invoke-PackwizRefresh
    Invoke-Validate
    Write-Color "💡 建议提交: 📌 chore(packwiz): pin dependencies" $Magenta
}

function Invoke-Unpin {
    Write-Color '📌 解除版本固定（交互式选择）...' $Cyan
    Invoke-Packwiz {
        & $PackwizBin --cache $CacheDir unpin
        if ($LASTEXITCODE -ne 0) { throw "packwiz unpin failed (exit $LASTEXITCODE)" }
    }
    Invoke-PackwizRefresh
    Invoke-Validate
    Write-Color "💡 建议提交: 📌 chore(packwiz): unpin dependencies" $Magenta
}

function Invoke-List {
    Write-Color "📋 当前依赖列表 ($($ResolvedTarget.Key)):" $Cyan
    Invoke-Packwiz {
        & $PackwizBin --cache $CacheDir list
        if ($LASTEXITCODE -ne 0) { throw "packwiz list failed (exit $LASTEXITCODE)" }
    }
}

function Invoke-Refresh {
    Invoke-Validate
}

function Invoke-Validate {
    Write-Color "🔍 校验整合包 ($($ResolvedTarget.Key)) ..." $Cyan
    $valScript = Join-Path $ScriptDir 'validate.ps1'
    & $valScript -PackPath $ResolvedTarget.path -Instance $ResolvedInstance -Version $ResolvedVersion -PromptCleanForbidden:$script:PromptForbiddenCleanup
    Write-Color "✅ 校验通过" $Green
}

function Invoke-Build {
    Write-Color "📦 导出 Modrinth .mrpack ($($ResolvedTarget.Key)) ..." $Cyan
    Invoke-Validate

    # 读取 pack 版本号
    $packFile = Join-Path $PackDir 'pack.toml'
    $versionLine = Select-String -LiteralPath $packFile -Pattern '^version = "([^"]+)"$'
    if (-not $versionLine) {
        throw "The pack version is missing from $packFile"
    }
    $packVersion = $versionLine.Matches[0].Groups[1].Value
    $outputName = "{0}-{1}.mrpack" -f $ResolvedTarget.artifact, $packVersion

    $distDir = Join-Path $RepoRoot 'dist'
    New-Item -ItemType Directory -Force -Path $distDir | Out-Null
    $outputPath = Join-Path $distDir $outputName

    Assert-Packwiz
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
    Push-Location $PackDir
    try {
        & $PackwizBin --cache $CacheDir modrinth export --output $outputPath
        if ($LASTEXITCODE -ne 0) {
            throw "packwiz Modrinth export failed (exit $LASTEXITCODE)"
        }
    }
    finally {
        Pop-Location
    }

    Write-Color "✅ 构建完成: $outputPath" $Green
}

function Invoke-SetModrinthVersion {
    param(
        [hashtable]$Entry,
        [string]$VersionUrl
    )

    if (-not (Test-Path $Entry.Path -PathType Leaf)) {
        throw "找不到依赖元数据: $($Entry.Path)"
    }

    # 保留原始元数据；指定版本链接无效时恢复，避免依赖因替换失败而丢失。
    $originalMetadata = [System.IO.File]::ReadAllBytes($Entry.Path)
    try {
        Write-Color "↩ 正在将 $($Entry.Name) 替换为指定版本 ..." $Cyan
        Invoke-Packwiz {
            & $PackwizBin --cache $CacheDir remove $Entry.Slug
            if ($LASTEXITCODE -ne 0) { throw "packwiz remove failed (exit $LASTEXITCODE)" }
        }
        Invoke-Packwiz {
            $pArgs = @(
                '--cache', $CacheDir,
                'modrinth', 'add',
                '--meta-folder', $Entry.Folder,
                '--meta-folder-base', '.',
                $VersionUrl
            )
            & $PackwizBin @pArgs
            if ($LASTEXITCODE -ne 0) { throw "packwiz modrinth add failed (exit $LASTEXITCODE)" }
        }
    }
    catch {
        if (-not (Test-Path $Entry.Path -PathType Leaf)) {
            [System.IO.File]::WriteAllBytes($Entry.Path, $originalMetadata)
            Write-Color '↩ 指定版本替换失败，已恢复原始元数据。' $Yellow
        }
        throw
    }

    Invoke-PackwizRefresh
    Invoke-Validate
    Write-Color "💡 建议提交: ⏪ fix(mod): 回退 $($Entry.Name) 到指定版本" $Magenta
}

function Invoke-Help {
    Write-Color "📦 Packwiz Workspace CLI" $Cyan
    Write-Color "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" $Gray
    Write-Color ''
    Write-Color '用法:' $White
    Write-Color "  .\scripts\pack.ps1 <命令> [选项] [参数]" $Gray
    Write-Color ''
    Write-Color '命令:' $White
    Write-Color '  add <slug|url>    从 Modrinth 添加依赖（-Source curseforge 可切换来源）' $Gray
    Write-Color '  remove <slug>      移除依赖（.pw.toml 文件名）' $Gray
    Write-Color '  update [slug]      更新依赖（无参数 = 全部更新）' $Gray
    Write-Color '  pin / unpin        固定 / 解除固定版本（交互式）' $Gray
    Write-Color '  list               列出当前依赖' $Gray
    Write-Color '  refresh            刷新 index.toml' $Gray
    Write-Color '  validate           校验整合包完整性' $Gray
    Write-Color '  build              导出 Modrinth .mrpack' $Gray
    Write-Color ''
    Write-Color '选项:' $White
    Write-Color '  -Instance <id>     指定整合包实例（如 client、server）' $Gray
    Write-Color '  -Version <ver>     指定 Minecraft 版本（如 1.21.1）' $Gray
    Write-Color "  -Folder <name>     meta-folder: mods|resourcepacks|shaderpacks (默认 mods)" $Gray
    Write-Color '  -Source <name>     依赖来源: modrinth|curseforge（默认 modrinth）' $Gray
    Write-Color '  -UpdateChannel <release|prerelease>' $Gray
    Write-Color '                       更新渠道（默认 release；prerelease 包含 alpha/beta）' $Gray
    Write-Color ''
    Write-Color '  -- <任意参数>      在目标项目目录中透传给 packwiz.exe（自动使用公共 cache）' $Gray
    Write-Color ''
    Write-Color "  无参数运行 = 交互菜单（先选择实例与 Minecraft 版本）" $Gray
    Write-Color ''
    Write-Color "当前目标: $($ResolvedTarget.Key)  |  路径: $($ResolvedTarget.path)" $Yellow
}

# ── 交互菜单 ──────────────────────────────────────────────

function Show-Banner {
    # 重定向输入或在某些终端宿主中没有可定位的光标，清屏失败不应中断菜单。
    try { Clear-Host } catch { }
    $info = Get-PackInfo $PackDir
    Write-Color "  📦 Packwiz Workspace CLI" $Cyan
    Write-Color "  ═══════════════════════════════════════════════" $Gray
    Write-Color "  目标: $($ResolvedTarget.Key)  |  包版本: $($info.Version)  |  Minecraft $($info.Minecraft)  |  Fabric $($info.Fabric)" $Yellow
    Write-Color ''
}

function Show-Menu {
    $items = @(
        @{Key='1'; Label='add      '; Desc='从 Modrinth 或 CurseForge 添加依赖'}
        @{Key='2'; Label='remove   '; Desc='移除依赖'}
        @{Key='3'; Label='update   '; Desc='更新依赖'}
        @{Key='4'; Label='pin      '; Desc='固定依赖版本'}
        @{Key='5'; Label='unpin    '; Desc='解除版本固定'}
        @{Key='6'; Label='list     '; Desc='列出当前依赖'}
        @{Key='7'; Label='refresh  '; Desc='刷新索引'}
        @{Key='8'; Label='build    '; Desc='校验并导出 .mrpack'}
        @{Key='9'; Label='version  '; Desc='指定/回退 Modrinth 版本'}
        @{Key='0'; Label='exit     '; Desc='退出'}
    )
    foreach ($item in $items) {
        Write-Color "  [$($item.Key)]" $Cyan -NoNewline
        Write-Color " $($item.Label)" $White -NoNewline
        Write-Color " $($item.Desc)" $Gray
    }
    Write-Color ''
    return $items
}

function Select-Entry($entries, $title, [switch]$ReturnEntry) {
    if (-not $entries) { Write-Color '⚠ 没有可用的依赖' $Yellow; return $null }
    Write-Color "  $title（输入编号或 slug）:" $Cyan
    for ($i = 0; $i -lt $entries.Count; $i++) {
        $n = '{0,2}' -f ($i + 1)
        Write-Color "  [$n] $($entries[$i].Slug)" $White -NoNewline
        Write-Color "  ← $($entries[$i].Name)" $Gray
    }
    Write-Color ''
    $sel = Read-Host '输入编号 / slug（直接回车取消）'
    if (-not $sel) { Write-Color '⏭ 已取消' $Yellow; return $null }
    if ($sel -match '^\d+$') {
        $idx = [int]$sel - 1
        if ($idx -ge 0 -and $idx -lt $entries.Count) {
            if ($ReturnEntry) { return $entries[$idx] }
            return $entries[$idx].Slug
        }
    }
    if ($ReturnEntry) {
        return $entries | Where-Object { $_.Slug -eq $sel } | Select-Object -First 1
    }
    return $sel
}

function Confirm-Removal([string]$Slug) {
    while ($true) {
        $answer = Read-Host "确认移除 '$Slug'？[y/N]"
        switch ($answer.Trim().ToLowerInvariant()) {
            'y' { return $true }
            'yes' { return $true }
            '' { return $false }
            'n' { return $false }
            'no' { return $false }
            default { Write-Color '请输入 y 或 n。' $Yellow }
        }
    }
}

function Confirm-VersionReplacement([string]$Name, [string]$VersionUrl) {
    while ($true) {
        $answer = Read-Host "确认将 '$Name' 替换为此版本？[y/N] $VersionUrl"
        switch ($answer.Trim().ToLowerInvariant()) {
            'y' { return $true }
            'yes' { return $true }
            '' { return $false }
            'n' { return $false }
            'no' { return $false }
            default { Write-Color '请输入 y 或 n。' $Yellow }
        }
    }
}

function Select-UpdateChannel {
    while ($true) {
        $answer = Read-Host '更新渠道 [r=仅正式版 release(默认) / p=包含 alpha/beta]'
        switch ($answer.Trim().ToLowerInvariant()) {
            '' { return 'release' }
            'r' { return 'release' }
            'release' { return 'release' }
            'p' { return 'prerelease' }
            'prerelease' { return 'prerelease' }
            default { Write-Color '请输入 r 或 p。' $Yellow }
        }
    }
}

function Select-NextAction([string]$Operation) {
    while ($true) {
        Write-Color ''
        $answer = Read-Host "$Operation 后 [r=继续 / Enter=主菜单 / 0=退出]"
        switch ($answer.Trim().ToLowerInvariant()) {
            'r' { return 'repeat' }
            '' { return 'menu' }
            '0' { return 'exit' }
            default { Write-Color '请输入 r、Enter 或 0。' $Yellow }
        }
    }
}

function Invoke-InteractiveFlow([string]$Operation, [scriptblock]$Action) {
    do {
        try {
            # 将原生命令的标准输出直接显示，避免它污染本函数的返回值。
            & $Action | Out-Host
        }
        catch {
            Write-Color "❌ $Operation 失败: $($_.Exception.Message)" $Red
        }
        $next = Select-NextAction $Operation
    } while ($next -eq 'repeat')

    return $next
}

function Show-InteractiveMenu {
    while ($true) {
        Show-Banner
        Show-Menu | Out-Null
        $choice = Read-Host '请选择操作 [0-9]'
        Write-Color ''

        $next = 'menu'
        switch ($choice) {
            '1' {
                $next = Invoke-InteractiveFlow '添加依赖' {
                    $sourceChoice = Read-Host '来源 [m=Modrinth(默认) / c=CurseForge]'
                    $targetSource = if ($sourceChoice.Trim().ToLowerInvariant() -eq 'c') { 'curseforge' } else { 'modrinth' }
                    $type = Read-Host '类型 [m=mods(默认) / r=resourcepacks / s=shaderpacks]'
                    $targetFolder = switch ($type.Trim().ToLowerInvariant()) {
                        'r' { 'resourcepacks' }
                        's' { 'shaderpacks' }
                        default { 'mods' }
                    }
                    $sourceLabel = if ($targetSource -eq 'curseforge') { 'CurseForge' } else { 'Modrinth' }
                    $slug = Read-Host "输入 $sourceLabel slug 或 URL (目标: $targetFolder；直接回车取消)"
                    if (-not $slug) {
                        Write-Color '⏭ 已取消' $Yellow
                    } else {
                        $global:Rest = @($slug)
                        Invoke-Add -TargetFolder $targetFolder -TargetSource $targetSource
                    }
                }
            }
            '2' {
                $next = Invoke-InteractiveFlow '移除依赖' {
                    $sel = Select-Entry (Get-PackEntries) '可移除的依赖'
                    if (-not $sel) {
                        # Select-Entry 已显示取消信息。
                    } elseif (-not (Confirm-Removal $sel)) {
                        Write-Color '⏭ 已取消' $Yellow
                    } else {
                        $global:Rest = @($sel)
                        Invoke-Remove
                    }
                }
            }
            '3' {
                $next = Invoke-InteractiveFlow '更新依赖' {
                    $script:UpdateChannel = Select-UpdateChannel
                    $scope = Read-Host '更新范围 [a=全部(默认) / s=单个]'
                    if ($scope.Trim().ToLowerInvariant() -eq 's') {
                        $sel = Select-Entry (Get-PackEntries) '可更新的依赖'
                        if ($sel) { $global:Rest = @($sel) }
                    } else {
                        $global:Rest = @()
                    }
                    if ($scope.Trim().ToLowerInvariant() -ne 's' -or $sel) { Invoke-Update }
                }
            }
            '4' { $next = Invoke-InteractiveFlow '固定版本' { Invoke-Pin } }
            '5' { $next = Invoke-InteractiveFlow '解除版本固定' { Invoke-Unpin } }
            '6' { $next = Invoke-InteractiveFlow '查看依赖列表' { Invoke-List } }
            '7' { $next = Invoke-InteractiveFlow '刷新索引' { Invoke-Refresh } }
            '8' { $next = Invoke-InteractiveFlow '构建整合包' { Invoke-Build } }
            '9' {
                $next = Invoke-InteractiveFlow '指定/回退 Modrinth 版本' {
                    $entry = Select-Entry (Get-ModrinthEntries) '可指定版本的 Modrinth 依赖' -ReturnEntry
                    if (-not $entry) {
                        # Select-Entry 已显示取消信息。
                    } else {
                        $versionUrl = Read-Host '粘贴 Modrinth 版本页面链接（直接回车取消）'
                        if (-not $versionUrl) {
                            Write-Color '⏭ 已取消' $Yellow
                        } elseif (-not (Confirm-VersionReplacement $entry.Name $versionUrl)) {
                            Write-Color '⏭ 已取消' $Yellow
                        } else {
                            Invoke-SetModrinthVersion -Entry $entry -VersionUrl $versionUrl
                        }
                    }
                }
            }
            '0' {
                Write-Color '👋 再见!' $Cyan
                return
            }
            default {
                Write-Color "❓ 未知选项: $choice" $Red
            }
        }
        if ($next -eq 'exit') {
            Write-Color '👋 再见!' $Cyan
            return
        }
    }
}

# ── 主入口 ────────────────────────────────────────────────

# 透传模式 (-- 或未知命令)
if ($Command -eq '--' -or ($Command -and $Command -notin 'add','remove','update','pin','unpin','list','refresh','validate','build','help')) {
    Assert-Packwiz
    $allArgs = if ($Command -eq '--') { $Rest } else { @($Command) + $Rest }
    Write-Color "🔧 透传 packwiz: $($allArgs -join ' ')" $Gray
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

    $passthruTarget = Resolve-PackTarget $Instance $Version
    Push-Location $passthruTarget.FullPath
    try {
        $pArgs = @('--cache', $CacheDir) + $allArgs
        & $PackwizBin @pArgs
        if ($LASTEXITCODE -ne 0) { throw "packwiz failed (exit $LASTEXITCODE)" }
    } finally { Pop-Location }
    return
}

# 解析实例与版本
$ResolvedTarget = Resolve-PackTarget $Instance $Version -PromptForSelection:(-not $Command)
if (-not $ResolvedTarget) {
    Write-Color '👋 再见!' $Cyan
    return
}
$ResolvedInstance = $ResolvedTarget.instance
$ResolvedVersion = $ResolvedTarget.version
$PackDir = $ResolvedTarget.FullPath

# 交互菜单（无命令）
if (-not $Command) {
    Show-InteractiveMenu
    return
}

# 帮助
if ($Command -eq 'help') {
    Invoke-Help
    return
}

# 分发子命令
Write-Color "📦 pack  |  目标: $($ResolvedTarget.Key)  |  Folder: $Folder" $Cyan

switch ($Command) {
    'add'      { Invoke-Add }
    'remove'   { Invoke-Remove }
    'update'   { Invoke-Update }
    'pin'      { Invoke-Pin }
    'unpin'    { Invoke-Unpin }
    'list'     { Invoke-List }
    'refresh'  { Invoke-Refresh }
    'validate' { Invoke-Validate }
    'build'    { Invoke-Build }
}

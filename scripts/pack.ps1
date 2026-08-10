#requires -Version 7.0

<#
.SYNOPSIS
    Preliminary Art Form 整合包开发 CLI

.DESCRIPTION
    统一的 packwiz 包装器，自动烘焙公共参数，支持交互菜单和智能版本探测。

.PARAMETER Command
    子命令: add, remove, update, pin, unpin, list, refresh, validate, build

.PARAMETER Version
    Minecraft 版本目录名（如 26.2）。省略时自动探测。

.PARAMETER Folder
    目标 meta-folder: mods (默认), resourcepacks, shaderpacks

.EXAMPLE
    .\scripts\pack.ps1 add sodium
    .\scripts\pack.ps1 add -Folder shaderpacks complementary-reimagined
    .\scripts\pack.ps1 remove sodium
    .\scripts\pack.ps1 update --all
    .\scripts\pack.ps1 update sodium
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
    [ValidateSet('mods', 'resourcepacks', 'shaderpacks')]
    [string]$Folder = 'mods',

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

# ── 版本探测 ──────────────────────────────────────────────

function Get-PackVersions {
    Get-ChildItem (Join-Path $RepoRoot 'packwiz') -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'pack.toml') -PathType Leaf } |
        ForEach-Object { $_.Name }
}

function Get-DefaultPackVersion($Versions) {
    $manifestPath = Join-Path $RepoRoot 'packwiz' 'versions.json'
    if (-not (Test-Path $manifestPath -PathType Leaf)) { return $null }

    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.default -and $manifest.default -in $Versions) {
        return $manifest.default
    }
    return $null
}

function Select-PackVersion($Versions, [string]$DefaultVersion) {
    while ($true) {
        try { Clear-Host } catch { }
        Write-Color '  🦐 Preliminary Art Form CLI' $Cyan
        Write-Color '  ═══════════════════════════════════════════════' $Gray
        Write-Color '  请选择要管理的 Minecraft 版本：' $Cyan
        Write-Color ''

        for ($i = 0; $i -lt $Versions.Count; $i++) {
            $version = $Versions[$i]
            $marker = if ($version -eq $DefaultVersion) { '（默认）' } else { '' }
            Write-Color "  [$($i + 1)] $version $marker" $White
        }
        Write-Color ''

        $hint = if ($DefaultVersion) {
            "输入编号或版本目录名（直接回车使用默认：$DefaultVersion；0=退出）"
        } else {
            '输入编号或版本目录名（0=退出）'
        }
        $selection = Read-Host $hint
        if ($selection -eq '0') { return $null }
        if (-not $selection -and $DefaultVersion) { return $DefaultVersion }
        if ($selection -match '^\d+$') {
            $index = [int]$selection - 1
            if ($index -ge 0 -and $index -lt $Versions.Count) { return $Versions[$index] }
        }
        if ($selection -in $Versions) { return $selection }
        Write-Color '❓ 无效版本，请重新选择。' $Red
    }
}

function Resolve-Version([string]$Requested, [switch]$PromptForSelection) {
    $all = @(Get-PackVersions)
    if (-not $all) { throw 'No packwiz version directories found under packwiz/' }

    if ($Requested) {
        $match = $all | Where-Object { $_ -eq $Requested }
        if (-not $match) { throw "Unknown version '$Requested'. Available: $($all -join ', ')" }
        return $Requested
    }

    if ($all.Count -eq 1) { return $all[0] }

    $defaultVersion = Get-DefaultPackVersion $all
    if ($PromptForSelection) {
        $selected = Select-PackVersion $all $defaultVersion
        if (-not $selected) { return $null }
        return $selected
    }

    if ($defaultVersion) { return $defaultVersion }
    throw "Multiple versions found ($($all -join ', ')). Use -Version or set 'default' in packwiz/versions.json"
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
    param([string]$TargetFolder = $Folder)

    # CLI: $Rest 来自命令行参数；菜单: $global:Rest 由交互流程写入
    $targets = if ($Rest) { @($Rest) } else { @($global:Rest) }
    $slug = $targets -join ' '
    if (-not $slug) { throw 'add 需要指定 Modrinth slug 或 URL' }

    Write-Color "🔍 从 Modrinth 搜索: $slug" $Cyan
    Write-Color "   meta-folder: $TargetFolder" $Gray

    Invoke-Packwiz {
        $pArgs = @(
            '--cache', $CacheDir,
            'modrinth', 'add',
            '--meta-folder', $TargetFolder,
            '--meta-folder-base', '.'
        ) + $targets

        & $PackwizBin @pArgs
        if ($LASTEXITCODE -ne 0) { throw "packwiz modrinth add failed (exit $LASTEXITCODE)" }
    }

    Write-Color "✅ $slug 已添加至 $TargetFolder/" $Green
    Invoke-PackwizRefresh
    Invoke-Validate

    # 建议提交信息使用 packwiz 写入的项目显示名，而不是用户输入的 URL。
    $commitTarget = $slug
    if ($targets.Count -eq 1) {
        $entrySlug = if ($targets[0] -match 'modrinth\.com/(?:mod|resourcepack|shader)/([^/?#]+)') {
            $Matches[1]
        } else {
            $targets[0]
        }
        $entry = Get-PackEntries | Where-Object {
            $_.Folder -eq $TargetFolder -and $_.Slug -eq $entrySlug
        } | Select-Object -First 1
        if ($entry) { $commitTarget = $entry.Name }
    }

    $scope = if ($TargetFolder -eq 'mods') { 'mod' } else { 'resource' }
    Write-Color "💡 建议提交: ✨ feat($scope): 添加 $commitTarget" $Magenta
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

function Invoke-Update {
    $targets = if ($Rest) { @($Rest) } else { @($global:Rest) }
    Write-Color '🔍 检查更新 ...' $Cyan

    Invoke-Packwiz {
        $pArgs = @('--cache', $CacheDir, 'update')
        if ($targets) { $pArgs += $targets }
        else { $pArgs += '--all' }
        & $PackwizBin @pArgs
        if ($LASTEXITCODE -ne 0) { throw "packwiz update failed (exit $LASTEXITCODE)" }
    }

    Write-Color '✅ 更新完成' $Green
    Invoke-PackwizRefresh
    Invoke-Validate

    $scope = if ($targets) { $targets[0] } else { '--all' }
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
    Write-Color "📋 当前依赖列表 ($ResolvedVersion):" $Cyan
    Invoke-Packwiz {
        & $PackwizBin --cache $CacheDir list
        if ($LASTEXITCODE -ne 0) { throw "packwiz list failed (exit $LASTEXITCODE)" }
    }
}

function Invoke-Refresh {
    Invoke-Validate
}

function Invoke-Validate {
    Write-Color "🔍 校验整合包 ($ResolvedVersion) ..." $Cyan
    $valScript = Join-Path $ScriptDir 'validate.ps1'
    & $valScript -MinecraftVersion $ResolvedVersion -PromptCleanForbidden:$script:PromptForbiddenCleanup
    Write-Color "✅ 校验通过" $Green
}

function Invoke-Build {
    Write-Color "📦 导出 Modrinth .mrpack ($ResolvedVersion) ..." $Cyan
    Invoke-Validate

    # 读取 pack 版本号
    $packFile = Join-Path $PackDir 'pack.toml'
    $versionLine = Select-String -LiteralPath $packFile -Pattern '^version = "([^"]+)"$'
    if (-not $versionLine) {
        throw "The pack version is missing from $packFile"
    }
    $packVersion = $versionLine.Matches[0].Groups[1].Value
    $outputName = "Preliminary Art Form_{0}.mrpack" -f $packVersion

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
    Write-Color "🦐 Preliminary Art Form CLI" $Cyan
    Write-Color "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" $Gray
    Write-Color ''
    Write-Color '用法:' $White
    Write-Color "  .\scripts\pack.ps1 <命令> [选项] [参数]" $Gray
    Write-Color ''
    Write-Color '命令:' $White
    Write-Color '  add <slug|url>    从 Modrinth 添加依赖' $Gray
    Write-Color '  remove <slug>      移除依赖（.pw.toml 文件名）' $Gray
    Write-Color '  update [slug]      更新依赖（无参数 = 全部更新）' $Gray
    Write-Color '  pin / unpin        固定 / 解除固定版本（交互式）' $Gray
    Write-Color '  list               列出当前依赖' $Gray
    Write-Color '  refresh            刷新 index.toml' $Gray
    Write-Color '  validate           校验整合包完整性' $Gray
    Write-Color '  build              导出 Modrinth .mrpack' $Gray
    Write-Color ''
    Write-Color '选项:' $White
    Write-Color '  -Version <ver>     指定 Minecraft 版本（默认自动探测）' $Gray
    Write-Color "  -Folder <name>     meta-folder: mods|resourcepacks|shaderpacks (默认 mods)" $Gray
    Write-Color ''
    Write-Color '  -- <任意参数>      透传给 packwiz.exe（使用公共 -cache -pack-file）' $Gray
    Write-Color ''
    Write-Color "  无参数运行 = 交互菜单（多版本时先选择版本）" $Gray
    Write-Color ''
    Write-Color "当前版本: $ResolvedVersion" $Yellow
}

# ── 交互菜单 ──────────────────────────────────────────────

function Show-Banner {
    # 重定向输入或在某些终端宿主中没有可定位的光标，清屏失败不应中断菜单。
    try { Clear-Host } catch { }
    $info = Get-PackInfo $PackDir
    Write-Color "  🦐 Preliminary Art Form CLI" $Cyan
    Write-Color "  ═══════════════════════════════════════════════" $Gray
    Write-Color "  版本: $($info.Version)  |  Minecraft $($info.Minecraft)  |  Fabric $($info.Fabric)" $Yellow
    Write-Color ''
}

function Show-Menu {
    $items = @(
        @{Key='1'; Label='add      '; Desc='从 Modrinth 添加依赖'}
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
                    $type = Read-Host '类型 [m=mods(默认) / r=resourcepacks / s=shaderpacks]'
                    $targetFolder = switch ($type.Trim().ToLowerInvariant()) {
                        'r' { 'resourcepacks' }
                        's' { 'shaderpacks' }
                        default { 'mods' }
                    }
                    $slug = Read-Host "输入 Modrinth slug 或 URL (目标: $targetFolder；直接回车取消)"
                    if (-not $slug) {
                        Write-Color '⏭ 已取消' $Yellow
                    } else {
                        $global:Rest = @($slug)
                        Invoke-Add -TargetFolder $targetFolder
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

    $passthruVersion = Resolve-Version $Version
    Push-Location (Join-Path $RepoRoot "packwiz/$passthruVersion")
    try {
        $pArgs = @('--cache', $CacheDir) + $allArgs
        & $PackwizBin @pArgs
        if ($LASTEXITCODE -ne 0) { throw "packwiz failed (exit $LASTEXITCODE)" }
    } finally { Pop-Location }
    return
}

# 解析版本
$ResolvedVersion = Resolve-Version $Version -PromptForSelection:(-not $Command)
if (-not $ResolvedVersion) {
    Write-Color '👋 再见!' $Cyan
    return
}
$PackDir = Join-Path $RepoRoot "packwiz" $ResolvedVersion

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
Write-Color "🦐 pack  |  版本: $ResolvedVersion  |  Folder: $Folder" $Cyan

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

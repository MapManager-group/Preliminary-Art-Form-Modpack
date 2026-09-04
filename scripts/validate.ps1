#requires -Version 7.0

param(
    [Parameter(Mandatory)]
    [string]$PackPath,

    [string]$Instance,
    [string]$Version,
    [switch]$PromptCleanForbidden
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path
$packDirectory = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $PackPath))
$repoPrefix = $repoRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$packwizExecutable = Join-Path $repoRoot 'packwiz.exe'
$cacheDirectory = Join-Path $repoRoot '.packwiz-cache'
$targetLabel = if ($Instance -and $Version) { "$Instance/$Version" } else { $PackPath }

if (-not $packDirectory.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Pack path must be inside the repository: $PackPath"
}
if (-not (Test-Path -LiteralPath $packwizExecutable -PathType Leaf)) {
    throw 'packwiz.exe was not found in the repository root.'
}
if (-not (Test-Path -LiteralPath (Join-Path $packDirectory 'pack.toml') -PathType Leaf)) {
    throw "pack.toml was not found for target: $targetLabel"
}

# 1. 阻止运行时、账号、日志和未批准的二进制依赖进入仓库。
$localFilesPath = Join-Path $repoRoot 'packwiz/local-files.json'
$allowedLocalFiles = @{}
if (Test-Path -LiteralPath $localFilesPath -PathType Leaf) {
    $localFilesManifest = Get-Content $localFilesPath -Raw -Encoding utf8 | ConvertFrom-Json
    foreach ($entry in @($localFilesManifest.files)) {
        foreach ($field in @('path', 'sha256', 'reason', 'license')) {
            if (-not $entry.$field) { throw "Missing '$field' in packwiz/local-files.json" }
        }
        $relativePath = ([string]$entry.path).Replace('\', '/').TrimStart('/')
        $fullPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $relativePath))
        if (-not $fullPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Local file allowlist path must stay inside the repository: $relativePath"
        }
        if ($allowedLocalFiles.ContainsKey($fullPath)) { throw "Duplicate local file allowlist path: $relativePath" }
        $allowedLocalFiles[$fullPath] = $entry
    }
}

$packRelativePrefix = [System.IO.Path]::GetRelativePath($repoRoot, $packDirectory).Replace('\', '/').TrimEnd('/') + '/'
foreach ($entry in $allowedLocalFiles.Values) {
    $relativePath = ([string]$entry.path).Replace('\', '/').TrimStart('/')
    if (-not $relativePath.StartsWith($packRelativePrefix, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $relativePath))
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Allowlisted local file is missing: $relativePath" }
    $actualHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne ([string]$entry.sha256).ToLowerInvariant()) {
        throw "Allowlisted local file hash mismatch: $relativePath"
    }
}

$jarFiles = @(Get-ChildItem -LiteralPath $packDirectory -Recurse -File -Filter '*.jar')
$unapprovedJars = @($jarFiles | Where-Object {
    $entry = $allowedLocalFiles[$_.FullName]
    if (-not $entry) { return $true }
    $actualHash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    return $actualHash -ne ([string]$entry.sha256).ToLowerInvariant()
})
if ($unapprovedJars) {
    throw "Unapproved JAR or allowlist hash mismatch found:`n$($unapprovedJars.FullName -join "`n")"
}

$forbiddenDirectories = Get-ChildItem -LiteralPath $packDirectory -Recurse -Directory | Where-Object {
    $_.Name -in @('blueprints', 'blob_cache', 'hotbars', 'logs', 'crash-reports', 'saves', 'screenshots')
}
$forbiddenFiles = Get-ChildItem -LiteralPath $packDirectory -Recurse -File | Where-Object {
    $_.Name -in @('accounts.json', 'launcher_accounts.json', 'usercache.json') -or
    $_.Extension -in @('.log', '.bak', '.backup')
}
$forbiddenPaths = @(
    @($forbiddenDirectories.FullName) + @($forbiddenFiles.FullName) |
        Where-Object { $_ }
)
if ($forbiddenPaths) {
    if (-not $PromptCleanForbidden) {
        throw "Forbidden runtime, account, or log content found:`n$($forbiddenPaths -join "`n")"
    }

    Write-Output "⚠ 发现不应纳入整合包的内容：`n$($forbiddenPaths -join "`n")"
    $answer = Read-Host '是否删除以上路径并继续校验？[y/N]'
    if ($answer.Trim().ToLowerInvariant() -notin @('y', 'yes')) {
        throw "Forbidden content found:`n$($forbiddenPaths -join "`n")"
    }

    $packRoot = $packDirectory.TrimEnd('\', '/')
    foreach ($path in $forbiddenPaths) {
        $resolvedPath = (Resolve-Path -LiteralPath $path).Path
        if (-not $resolvedPath.StartsWith("$packRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to delete path outside the selected pack: $resolvedPath"
        }
        Remove-Item -LiteralPath $resolvedPath -Recurse -Force
    }
    Write-Output "✓ 已清理 $($forbiddenPaths.Count) 个禁止路径"
}

$allowedJarCount = $jarFiles.Count - $unapprovedJars.Count
Write-Output "✓ 无未批准 JAR、账号、日志或运行时残留文件；允许的本地 JAR: $allowedJarCount"

# 2. 刷新索引，并让 packwiz 解析一次项目。
& (Join-Path $PSScriptRoot 'normalize-pack-line-endings.ps1') -PackDirectory $packDirectory
Push-Location $packDirectory
try {
    New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
    & $packwizExecutable --cache $cacheDirectory refresh
    if ($LASTEXITCODE -ne 0) { throw "packwiz refresh failed with exit code $LASTEXITCODE" }
    & $packwizExecutable --cache $cacheDirectory list | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "packwiz list failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}

Write-Output '✓ packwiz refresh & list 通过'

# 3. 双向检查所有外部依赖元数据是否进入 index.toml。
$pwTomlFiles = @(Get-ChildItem -LiteralPath $packDirectory -Recurse -File -Filter '*.pw.toml')
$diskSlugs = @($pwTomlFiles | ForEach-Object {
    $_.FullName.Substring($packDirectory.Length + 1) -replace '\\', '/'
})
$indexPath = Join-Path $packDirectory 'index.toml'
$indexContent = Get-Content $indexPath -Raw
$indexMetafiles = @(
    [regex]::Matches($indexContent, '(?m)^file\s*=\s*"([^"]+\.pw\.toml)"') |
        ForEach-Object { $_.Groups[1].Value }
)

$missingInIndex = @($diskSlugs | Where-Object { $_ -notin $indexMetafiles })
$missingOnDisk = @($indexMetafiles | Where-Object { $_ -notin $diskSlugs })
if ($missingInIndex) { throw "Metadata missing from index.toml:`n$($missingInIndex -join "`n")" }
if ($missingOnDisk) { throw "Metadata missing on disk:`n$($missingOnDisk -join "`n")" }
if ($pwTomlFiles.Count -ne $indexMetafiles.Count) {
    throw "Mismatch: $($pwTomlFiles.Count) metadata files on disk vs $($indexMetafiles.Count) in index.toml"
}

Write-Output "✓ Validated ${targetLabel}: $($pwTomlFiles.Count) external dependencies"

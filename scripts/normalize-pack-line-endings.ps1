param(
    [Parameter(Mandatory)]
    [string]$PackDirectory
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path
$resolvedPackDirectory = (Resolve-Path -LiteralPath $PackDirectory).Path
$repoPrefix = $repoRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar

if (-not $resolvedPackDirectory.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Pack directory must be inside the repository: $resolvedPackDirectory"
}

$forbiddenDirectoryNames = @('blueprints', 'blob_cache', 'hotbars')
$forbiddenFileNames = @('accounts.json', 'launcher_accounts.json', 'usercache.json')
$forbiddenExtensions = @('.log', '.bak', '.backup')
$normalizedCount = 0

Get-ChildItem -LiteralPath $resolvedPackDirectory -Recurse -File | ForEach-Object {
    $file = $_
    if ($file.Name -in $forbiddenFileNames -or $file.Extension -in $forbiddenExtensions) { return }
    if (@($file.DirectoryName.Split([System.IO.Path]::DirectorySeparatorChar) | Where-Object { $_ -in $forbiddenDirectoryNames }).Count -gt 0) { return }

    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $crlfCount = 0
    for ($i = 0; $i -lt $bytes.Length - 1; $i++) {
        if ($bytes[$i] -eq 13 -and $bytes[$i + 1] -eq 10) {
            $crlfCount++
            $i++
        }
    }
    if ($crlfCount -eq 0) { return }

    $relativePath = [System.IO.Path]::GetRelativePath($repoRoot, $file.FullName).Replace('\', '/')
    $attributes = & git -C $repoRoot check-attr text eol -- $relativePath
    if ($LASTEXITCODE -ne 0) { throw "git check-attr failed for $relativePath" }
    if ($attributes -match ': text: unset$' -or $attributes -notmatch ': eol: lf$') { return }

    $normalizedBytes = [byte[]]::new($bytes.Length - $crlfCount)
    $sourceIndex = 0
    $targetIndex = 0
    while ($sourceIndex -lt $bytes.Length) {
        if ($sourceIndex -lt $bytes.Length - 1 -and $bytes[$sourceIndex] -eq 13 -and $bytes[$sourceIndex + 1] -eq 10) {
            $normalizedBytes[$targetIndex] = 10
            $sourceIndex += 2
        } else {
            $normalizedBytes[$targetIndex] = $bytes[$sourceIndex]
            $sourceIndex++
        }
        $targetIndex++
    }

    [System.IO.File]::WriteAllBytes($file.FullName, $normalizedBytes)
    $normalizedCount++
}

Write-Output "✓ 已将 $normalizedCount 个 packwiz 文本文件规范化为 LF"

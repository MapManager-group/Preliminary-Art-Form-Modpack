#requires -Version 7.3
# Local UI only. All package/game writes go through the Workspace CLI.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$PSNativeCommandArgumentPassing = 'Standard'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($env:NO_COLOR -or $env:TERM -eq 'dumb') { $PSStyle.OutputRendering='PlainText' }
$script:EntryArguments = @($args)
$script:RuntimeChoice = $null
$script:LastResult = $null

# Explicit opt-in: no font detection, installation or terminal configuration.
$script:IconMode='plain'
$script:DisplayModes=@('plain','nerd','emoji')
$script:DisplayLabels=@{plain='纯文本';nerd='Nerd Font';emoji='Emoji'}
$script:UiIcons=@{
    ok=@('[成功]',[char]0xf00c,'✅')
    warn=@('[警告]',[char]0xf071,'⚠️')
    error=@('[错误]',[char]0xf00d,'❌')
    info=@('[提示]',[char]0xf05a,'ℹ️')
    wait=@('[执行]',[char]0xf252,'⏳')
    target=@('',[char]0xf140,'🎯')
    runtime=@('',[char]0xf11b,'🎮')
    launcher=@('',[char]0xf11b,'🕹️')
    git=@('',[char]0xf126,'🌿')
    import=@('',[char]0xf019,'📥')
    build=@('',[char]0xf187,'📦')
    add=@('',[char]0xf067,'➕')
    remove=@('',[char]0xf068,'➖')
    refresh=@('',[char]0xf021,'🔄')
    list=@('',[char]0xf03a,'📋')
    search=@('',[char]0xf002,'🔎')
    check=@('',[char]0xf002,'🔍')
    back=@('',[char]0xf060,'↩️')
    recover=@('',[char]0xf1cd,'🛟')
    dev=@('',[char]0xf135,'🚀')
    preview=@('',[char]0xf06e,'👀')
    bind=@('',[char]0xf0c1,'🔗')
    unbind=@('',[char]0xf127,'🔓')
    new=@('',[char]0xf067,'🆕')
    folder=@('',[char]0xf07c,'📂')
    settings=@('',[char]0xf013,'⚙️')
    tag=@('',[char]0xf02b,'🏷️')
    doctor=@('',[char]0xf0f1,'🩺')
    edit=@('',[char]0xf044,'📝')
    tools=@('',[char]0xf0ad,'🛠️')
    home=@('',[char]0xf015,'🏠')
    apply=@('',[char]0xf019,'📲')
    file=@('',[char]0xf15b,'📄')
    client=@('',[char]0xf108,'🖥️')
    mod=@('',[char]0xf12e,'🧩')
}
function Get-UiIcon([string] $Name, [string] $Mode=$script:IconMode) {
    return $script:UiIcons[$Name][[Array]::IndexOf($script:DisplayModes,$Mode)]
}
# Menu accents use terminal palette colors; body text keeps the terminal default.
$script:MenuColors=@{key='Cyan';icon='Magenta';group='DarkCyan';ok='Green';warn='Yellow';error='Red';info='Cyan';wait='Cyan'}
function Format-MenuText([string] $Text, [bool] $UseColor=($Host.UI.SupportsVirtualTerminal -and -not [Console]::IsOutputRedirected -and -not $env:NO_COLOR -and $env:TERM -ne 'dumb' -and $PSStyle.OutputRendering -ne 'PlainText')) {
    if (-not $UseColor) { return $Text }
    $icons=@($script:UiIcons.Values | ForEach-Object { $_ } | Where-Object { [string]$_ -ne '' } | ForEach-Object { [regex]::Escape([string]$_) } | Sort-Object -Unique)
    $pattern='(?<key>\[(?:[0-9]+|r|d|s)\])|(?<icon>'+($icons -join '|')+')'
    return [regex]::Replace($Text,$pattern,[System.Text.RegularExpressions.MatchEvaluator]{ param($match)
        $role=if ($match.Groups['key'].Success) { 'key' } else { 'icon' }
        if ($role -eq 'icon') {
            foreach ($status in @('ok','warn','error','info','wait')) {
                if ($match.Value -cin @($script:UiIcons[$status] | ForEach-Object { [string]$_ })) { $role=$status; break }
            }
        }
        return $PSStyle.Foreground.FromConsoleColor([ConsoleColor]$script:MenuColors[$role])+$match.Value+"`e[39m"
    })
}
function Write-MenuLine([string] $Text) { Write-Host (Format-MenuText $Text) }
function Initialize-Display {
    $file=Join-Path $PSScriptRoot '.local/menu.json'
    if (Test-Path -LiteralPath $file) {
        try {
            $settings=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json -AsHashtable
            if ($settings.schema -ne 1 -or $settings.icons -cnotin $script:DisplayModes) { throw '无效的显示配置' }
            $script:IconMode=$settings.icons
        } catch { Write-Host '[警告] 本机显示配置无法读取，使用纯文本；可在显示设置中重新保存。' -ForegroundColor Yellow }
    }
    if ($env:MP_ICONS -cin $script:DisplayModes) { $script:IconMode=$env:MP_ICONS }
    elseif ($env:MP_ICONS) { Write-Host '[警告] MP_ICONS 无效，使用本机显示设置。' -ForegroundColor Yellow }
}
function Save-Display([string] $Mode) {
    $directory=Join-Path $PSScriptRoot '.local'
    $file=Join-Path $directory 'menu.json'
    foreach ($item in @($directory,$file)) {
        if ((Test-Path -LiteralPath $item) -and ((Get-Item -LiteralPath $item -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '显示配置路径不能是链接。' }
    }
    $null=[IO.Directory]::CreateDirectory($directory)
    $temp=Join-Path $directory ('menu.'+[guid]::NewGuid().ToString()+'.tmp')
    try {
        [IO.File]::WriteAllText($temp,(@{schema=1;icons=$Mode} | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temp,$file,$true)
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
    $script:IconMode=$Mode
}
function Show-DisplaySettings {
    Show-Page '显示设置' '查看图标样例，选择适合当前终端的显示方式。'
    Write-Host "当前模式: $($script:DisplayLabels[$script:IconMode])"
    for ($i=0; $i -lt $script:DisplayModes.Count; $i++) {
        $mode=$script:DisplayModes[$i]
        Write-MenuLine "  [$($i+1)] $($script:DisplayLabels[$mode])"
        Write-MenuLine "      $(Get-UiIcon ok $mode) 成功  $(Get-UiIcon warn $mode) 警告  $(Get-UiIcon error $mode) 错误"
        Write-MenuLine "      $(Get-UiIcon target $mode) 目标  $(Get-UiIcon runtime $mode) 实例  $(Get-UiIcon build $mode) 构建"
    }
    Write-Host '图标若显示为方框或错位，请选择纯文本；不会自动安装字体。'
    Write-MenuLine '  [0] 返回，不修改设置'
    while ($true) {
        $choice=Read-Choice '选择显示模式'
        if ($choice -eq '0') { return }
        if ($choice -notin @('1','2','3')) { Write-Host '请输入 0–3。' -ForegroundColor Yellow; continue }
        $mode=$script:DisplayModes[[int]$choice-1]
        Invoke-MenuOperation -KeepDetails {
            Save-Display $mode
            Write-Host "已切换为 $($script:DisplayLabels[$mode])，并保存到 .local/menu.json。"
            if ($env:MP_ICONS -cin $script:DisplayModes) { Write-Host '下次启动仍优先使用 MP_ICONS；运行 Remove-Item Env:MP_ICONS 后启动即可沿用本机选择。' -ForegroundColor Yellow }
        }
        return
    }
}


function Show-Help {
    Write-Host @'
Preliminary Art Form v2 — 本地开发入口（PowerShell 7.3+）
  .\ci.ps1                           中文菜单
  .\ci.ps1 help                      本帮助
  .\ci.ps1 status
  .\ci.ps1 check [-Target <id> | -All]
  .\ci.ps1 build -Target <id>
  .\ci.ps1 deploy -Runtime <name> -Target <id> -Stopped
  .\ci.ps1 changes -Runtime <name>
  .\ci.ps1 collect -Runtime <name> -File <相对路径> -Confirm -Stopped
  .\ci.ps1 mp -- <原始 mp 参数...>     透明转发

快捷参数：-Target -Runtime -All -DryRun -Stopped -Confirm -File -Source
          -Java -Launcher -GameDir -VersionDir -ConfirmGameDir -AdoptExisting
          -Operation -Project -Candidate -AcceptHash -Repo -Run -Release -Sha256 -Selection -Delete -Json
原生 --参数 同样可用。含空格路径用引号包围；参数按数组传递，不执行输入中的代码。
直接命令不询问确认，也不会自动加 -Stopped / -Confirm。退出码与 mp 一致。
高级示例：.\ci.ps1 mp -- pakku --target fabric-1.21.1 -- cfg --name '我的整合包'
菜单只调用现有 CLI；此脚本不是 GitHub Actions 运行器，不自动启动游戏或推送 Git。
'@
}

function Initialize-Tools {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '未找到 Node.js。请安装 Node.js 24，再重新打开 PowerShell。' }
    $script:Pnpm = Get-Command pnpm.ps1 -ErrorAction SilentlyContinue
    if (-not $script:Pnpm) { $script:Pnpm = Get-Command pnpm -ErrorAction SilentlyContinue }
    if (-not $script:Pnpm -or $script:Pnpm.Source -match '\.(cmd|bat)$') {
        throw '未找到可安全调用的 pnpm。请安装 pnpm 10.28.2（Windows 需 pnpm.ps1 或 pnpm.exe），再重新打开 PowerShell。'
    }
    if ((Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package.json')) -and
        -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/fflate'))) {
        throw '尚未安装项目依赖。请先在项目目录执行 pnpm install --frozen-lockfile。'
    }
}

function Convert-DirectArguments([string[]] $Values) {
    if ($Values[0] -eq 'mp') {
        $rest = @($Values | Select-Object -Skip 1)
        if ($rest.Count -and $rest[0] -eq '--') { $rest = @($rest | Select-Object -Skip 1) }
        return ,$rest
    }
    $aliases = @{
        '-Target'='--target'; '-All'='--all'; '-DryRun'='--dry-run'; '-Stopped'='--stopped'
        '-Confirm'='--confirm'; '-File'='--file'; '-Source'='--source'; '-Java'='--java'
        '-Launcher'='--launcher'; '-GameDir'='--game-dir'; '-VersionDir'='--version-dir'
        '-ConfirmGameDir'='--confirm-game-dir'; '-AdoptExisting'='--adopt-existing'
        '-Operation'='--operation'; '-Project'='--project'; '-Candidate'='--candidate'
        '-AcceptHash'='--accept-hash'; '-Repo'='--repo'; '-Run'='--run'; '-Release'='--release'
        '-Sha256'='--sha256'; '-Selection'='--selection'; '-Delete'='--delete'; '-Json'='--json'
    }
    $valueFlags = @('--target','--file','--source','--java','--launcher','--game-dir','--version-dir','--operation','--project','--candidate','--accept-hash','--repo','--run','--release','--sha256','--selection')
    $out = [System.Collections.Generic.List[string]]::new()
    $out.Add($Values[0])
    $runtimeName = $null
    for ($i = 1; $i -lt $Values.Count; $i++) {
        $value = $Values[$i]
        if ($value -eq '--') { for (; $i -lt $Values.Count; $i++) { $out.Add($Values[$i]) }; break }
        if ($value -eq '-Runtime') {
            if ($runtimeName -or ++$i -ge $Values.Count -or $Values[$i].StartsWith('-')) { throw '-Runtime 需要一个实例名，且不能重复' }
            $runtimeName = $Values[$i]
            continue
        }
        if ($aliases.ContainsKey($value)) { $value = $aliases[$value] }
        $out.Add($value)
        if ($value -in $valueFlags) {
            if (++$i -ge $Values.Count) { throw "$value 缺少值" }
            $out.Add($Values[$i])
        }
    }
    if ($runtimeName) { $out.Insert(1, $runtimeName) }
    return ,$out.ToArray()
}

# Both modes use this exact forwarding path. No shell command strings or eval.
function Invoke-Mp([string[]] $Arguments, [switch] $Capture) {
    $global:LASTEXITCODE = 0
    $pnpmArguments = @('--silent','run','mp','--') + $Arguments
    if (-not $Capture) {
        & $script:Pnpm.Source @pnpmArguments | Out-Host
        return $LASTEXITCODE
    }
    $previousProgress=$env:MP_PROGRESS
    $lines=[System.Collections.Generic.List[string]]::new()
    $raw=[System.Collections.Generic.List[string]]::new()
    try {
        $env:MP_PROGRESS='jsonl'
        & $script:Pnpm.Source @pnpmArguments 2>&1 | ForEach-Object {
            $line="$_"
            $event=Read-ProgressEvent $line
            if ($event) {
                if ($event.type -eq 'progress') {
                    $raw.Add($line)
                    Write-Host "$(Get-UiIcon wait) $($event.message)" -ForegroundColor Cyan
                } else { $raw.Add($event.text) }
            } else { $lines.Add($line); $raw.Add($line) }
        }
        $code=$LASTEXITCODE
    } finally { $env:MP_PROGRESS=$previousProgress }
    return Convert-MpResult $lines.ToArray() $raw.ToArray() $code
}
function Read-ProgressEvent([string] $Line) {
    if (-not $Line.StartsWith('@mp:')) { return $null }
    try {
        $event=ConvertFrom-Json -InputObject $Line.Substring(4) -AsHashtable -ErrorAction Stop
        if ($event.schema -ne 1) { return $null }
        if ($event.type -eq 'progress' -and $event.stage -is [string] -and $event.message -is [string]) { return $event }
        if ($event.type -eq 'diagnostic' -and $event.text -is [string]) { return $event }
    } catch { }
    return $null
}
function Convert-MpResult([string[]] $lines, [string[]] $raw, [int] $code) {
    $records = [System.Collections.Generic.List[object]]::new()
    $messages = [System.Collections.Generic.List[string]]::new()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $found = $false
        if ($lines[$i] -match '^[\[{]') {
            $buffer = ''
            for ($j = $i; $j -lt $lines.Count; $j++) {
                $buffer += $lines[$j] + "`n"
                if ($lines[$j] -notmatch '[\]}]\s*$') { continue }
                try {
                    # ConvertFrom-Json accepts some incomplete arrays; validate the full document first.
                    $document = [System.Text.Json.JsonDocument]::Parse($buffer)
                    $document.Dispose()
                    $value = ConvertFrom-Json -InputObject $buffer -AsHashtable -NoEnumerate -ErrorAction Stop
                    $records.Add($value); $i = $j; $found = $true; break
                } catch { }
            }
        }
        if (-not $found) { $messages.Add($lines[$i]) }
    }
    return @{ Code=$code; Records=$records.ToArray(); Messages=$messages.ToArray(); Raw=($raw -join "`n") }
}

function Read-Choice([string] $Prompt) {
    if ([Console]::IsInputRedirected) { Write-Host $Prompt; $value = [Console]::ReadLine() }
    else { $value = Read-Host $Prompt }
    if ($null -eq $value) { throw '输入已结束；菜单已停止。' }
    return $value.Trim()
}
function Confirm-Action([string] $Prompt) {
    while ($true) {
        $answer=Read-Choice "$Prompt [y/N，d 查看详细输出]"
        if ($answer -eq 'd') { Write-Host $script:LastResult.Raw; continue }
        return $answer -ceq 'y'
    }
}
# Redirected input accepts key names, keeping the same state machine testable without a terminal.
function Read-SelectionKey {
    if ([Console]::IsInputRedirected) {
        $key=Read-Choice '按键（up/down/space/a/n/enter/esc）'
        if ($key -eq '') { return 'enter' }; return $key.ToLowerInvariant()
    }
    switch ([Console]::ReadKey($true).Key) {
        UpArrow { 'up' }; DownArrow { 'down' }; Spacebar { 'space' }
        A { 'a' }; N { 'n' }; Enter { 'enter' }; Escape { 'esc' }
    }
}
function Select-Multiple($Items, [string] $Label) {
    $Items=@($Items)
    if (-not $Items.Count) { Write-Host "$(Get-UiIcon info) 没有可选文件。"; return ,@() }
    $selected=[bool[]]::new($Items.Count); $cursor=0
    while ($true) {
        if (-not [Console]::IsOutputRedirected -and -not [Console]::IsInputRedirected) { Clear-Host }
        Show-Page $Label '↑ / ↓ 移动 · Space 选择 · A 全选 · N 全不选 · Enter 确认 · Esc 返回'
        Write-Host "  已选择 $(@($selected | Where-Object { $_ }).Count) / $($Items.Count)"
        $pageSize=12
        if (-not [Console]::IsOutputRedirected) { $pageSize=[Math]::Max(1,[Math]::Min(12,[Console]::WindowHeight-16)) }
        $start=[Math]::Max(0,$cursor-[int][Math]::Floor($pageSize/2)); $end=[Math]::Min($Items.Count,$start+$pageSize)
        for ($i=$start; $i -lt $end; $i++) {
            $mark=if ($selected[$i]) { 'x' } else { ' ' }
            $arrow=if ($cursor -eq $i) { '›' } else { ' ' }
            Write-Host "  $arrow [$mark] $(Format-DisplayPath $Items[$i].path)"
        }
        Write-Host "  第 $($cursor+1) / $($Items.Count) 项" -ForegroundColor DarkGray
        switch (Read-SelectionKey) {
            'up' { $cursor=[Math]::Max(0,$cursor-1) }
            'down' { $cursor=[Math]::Min($Items.Count-1,$cursor+1) }
            'space' { $selected[$cursor]=-not $selected[$cursor] }
            'a' { for ($i=0; $i -lt $selected.Length; $i++) { $selected[$i]=$true } }
            'n' { [Array]::Clear($selected,0,$selected.Length) }
            'esc' { throw '已取消。' }
            'enter' { return ,@((0..($Items.Count-1)) | Where-Object { $selected[$_] } | ForEach-Object { $Items[$_] }) }
        }
    }
}
function Pause-ForContinue {
    while ((Read-Choice '按 Enter 继续') -ne '') { Write-Host '请直接按 Enter 返回菜单。' -ForegroundColor DarkGray }
}
function Invoke-MenuOperation([scriptblock] $Action, [switch] $KeepDetails) {
    if (-not $KeepDetails) { $script:LastResult=$null }
    $script:OperationWarning=$false
    try {
        & $Action
        if ($script:OperationWarning) { Write-Host "`n$(Get-UiIcon warn) 操作结束，请查看上方提示。" -ForegroundColor Yellow }
        else { Write-Host "`n$(Get-UiIcon ok) 操作结束。" -ForegroundColor Green }
    }
    catch {
        if ($_.Exception.Message -eq '已取消。') { Write-Host "`n$(Get-UiIcon info) 已取消操作。" -ForegroundColor Yellow }
        else { Save-Details $_.Exception.Message; Write-Host "`n$(Get-UiIcon error) $($_.Exception.Message)" -ForegroundColor Red }
    }
    finally { Pause-ForContinue }
}
function Format-DisplayPath([string] $Value) {
    if ($Value.StartsWith($PSScriptRoot + [IO.Path]::DirectorySeparatorChar)) { $Value='.' + $Value.Substring($PSScriptRoot.Length) }
    $Value=$Value.Replace("`r",'␍').Replace("`n",'␊').Replace("`t",'⇥')
    if ($Value.Length -gt 100) { return $Value.Substring(0,35)+'…'+$Value.Substring($Value.Length-60) }
    return $Value
}
function Read-RuntimeId {
    while ($true) {
        $value=Read-Required '实例名称，例如 pcl2-debug / hmcl-dev / pcl2-fabric-1211'
        if ($value -cmatch '^[a-z0-9][a-z0-9_-]*$') { return $value }
        Write-Host "$(Get-UiIcon warn) 实例名称须以小写字母或数字开头，仅允许小写字母、数字、-、_；不能含句点。示例：pcl2-debug、hmcl-dev、pcl2-fabric-1211。" -ForegroundColor Yellow
    }
}
function Read-Required([string] $Prompt) {
    $value = Read-Choice "$Prompt（0 取消）"
    if (-not $value -or $value -eq '0') { throw '已取消。' }
    return $value
}
function Show-Rows($Rows) {
    foreach ($row in $Rows) {
        if ($row -is [string]) { Write-Host "  $row"; continue }
        Write-Host "  $($row.type)$($row.state) $($row.path) $($row.reason)"
    }
}
function Show-FilePlan($Record) {
    $counts=@{}
    foreach ($kind in @('add','update','delete')) { $counts[$kind]=@($Record.actions | Where-Object type -EQ $kind).Count }
    Write-Host "文件变更: $(@($Record.actions).Count) | 新增: $($counts.add) | 修改: $($counts.update) | 删除: $($counts.delete) | 冲突: $(@($Record.conflicts).Count)"
    if (@($Record.conflicts).Count) { $script:OperationWarning=$true }
    Write-Host "保留未知文件: $(@($Record.preserved).Count) | 待下载: $(@($Record.downloads).Count)"
}
function Show-Summary($Result) {
    $seen=[System.Collections.Generic.HashSet[string]]::new()
    if ($Result.Code -ne 0) {
        $message=@($Result.Messages | Where-Object { $_ }) | Select-Object -Last 1
        if ($message) { Write-Host (Format-DisplayPath $message) -ForegroundColor Red }
    }
    if (-not $Result.Records.Count -and $Result.Code -eq 0 -and $Result.Messages.Count) {
        Write-Host (Format-DisplayPath ($Result.Messages | Where-Object { $_ } | Select-Object -Last 1))
    }
    foreach ($record in $Result.Records) {
        if ($record -isnot [System.Collections.IDictionary]) { continue }
        $summaryKey=if ($record.Contains('actions')) {
            ConvertTo-Json @($record.actions,$record.conflicts,$record.preserved,$record.downloads) -Depth 100 -Compress
        } else { ConvertTo-Json $record -Depth 100 -Compress }
        if (-not $seen.Add($summaryKey)) { continue }
        if ($record.action -in @('inspect-pack','create-project')) {
            Write-Host "工程: $($record.name) | Target: $($record.target) | Minecraft: $($record.mc) | Loader: $($record.loader) $($record.loaderVersion)"
            if ($record.directory) { Write-Host "目录: $($record.directory) | 发布平台: $($record.platform)" }
            Write-Host "依赖: $($record.dependencies) | 已转换: $(@($record.converted).Count) | 覆盖文件: $(@($record.overrides).Count) | 跳过: $(@($record.skipped).Count) | 无法转换: $(@($record.issues).Count)"
            foreach ($item in $record.issues) { Write-Host "  $(Format-DisplayPath $item.path)：$($item.reason)" -ForegroundColor Yellow }
            if ($record.created) { Write-Host "创建完成，检查通过。下一步：mp use $($record.target)，添加依赖或编辑覆盖配置，再构建。" }
            elseif ($record.notice) { Write-Host $record.notice }
            if (@($record.issues).Count) { $script:OperationWarning=$true }
        } elseif ($record.output) {
            Write-Host "目标: $($record.target)`n输出: $(Format-DisplayPath $record.output)"
            foreach ($artifact in $record.artifacts) { Write-Host "  $($artifact.kind): $($artifact.name)" }
            Write-Host "报告: $(Format-DisplayPath (Join-Path $record.output 'build-report.json'))"
            if (@($record.uncollected).Count) { $script:OperationWarning=$true; Write-Host "未收集产物: $($record.uncollected.Count)，按 d 查看。" -ForegroundColor Yellow }
        } elseif ($record.action -eq 'bind') {
            $r = $record.runtime
            Write-Host "实例: $($r.id) / $($r.targetId) / $($r.launcher)"
            Write-Host "游戏目录: $(Format-DisplayPath $r.gameDir)`n版本目录: $(Format-DisplayPath $r.versionDir)`nMinecraft: $($r.mc)"
            Write-Host "加载器: $(ConvertTo-Json $r.loaders -Compress) | 隔离: $($r.layout)"
            Write-Host $r.evidence
            Write-Host "现有 Mod/配置: $(@($record.existing).Count) 个（不自动接管）"
        } elseif ($record.action -eq 'apply') {
            Write-Host "目标: $($record.target) | 包版本: $($record.version) | 来源: $($record.provenance.kind)"
        } elseif ($record.action -eq 'recover') {
            Write-Host "待恢复文件: $(@($record.files).Count)"
        } elseif ($record.action -eq 'import-batch') {
            Write-Host "$(Get-UiIcon build) 成功识别: $(@($record.recognized).Count) | 跳过: $(@($record.skipped).Count) | 失败: $(@($record.failed).Count) | 待导入项目: $($record.pending)"
            foreach ($item in $record.recognized) { Write-Host "  $(Get-UiIcon ok) $(Format-DisplayPath $item.path) → $($item.project)" }
            foreach ($item in $record.skipped) { Write-Host "  ─ $(Format-DisplayPath $item.path)：$($item.reason)" -ForegroundColor DarkGray }
            foreach ($item in $record.failed) { Write-Host "  $(Get-UiIcon error) $(Format-DisplayPath $item.path)：$(Format-DisplayPath $item.reason)" -ForegroundColor Red }
            foreach ($item in @($record.added | Where-Object { $_.pakku_id -notin @($record.recognized.pakkuId) })) {
                Write-Host "  自动依赖: $($item.name.Values -join ' / ')"
            }
            if ($record.blocked) { $script:OperationWarning=$true; Write-Host "$(Get-UiIcon warn) 本批未导入；排除异常项后重新选择。" -ForegroundColor Yellow }
            Write-Host '输入 d 可查看 Pakku 日志、完整哈希及 Lock Diff。' -ForegroundColor DarkGray
        } elseif ($record.action -eq 'import-deps') {
            Write-Host "待识别 JAR: $(@($record.candidates).Count) | 已跳过: $(@($record.skipped).Count)"
        } elseif ($record.Contains('managed')) {
            $labels=@{managed='受管文件';conflicts='冲突';candidates='新增配置';dependencies='Mod 变化'}
            foreach ($key in @('managed','conflicts','candidates','dependencies')) {
                Write-Host "$($labels[$key]) : $(@($record[$key]).Count)"
            }
            if (@($record.conflicts).Count) { $script:OperationWarning=$true }
        } elseif ($record.Contains('actions')) {
            Show-FilePlan $record
        } elseif ($record.projectPath) {
            Write-Host "待接受依赖: $($record.operation) $($record.project) | 新增项目: $(@($record.added).Count)"
            foreach ($item in $record.added) {
                Write-Host "  $(Get-UiIcon add) $($item.name.Values -join ' / ')（$($item.slug.Values -join ' / ')）"
            }
            Write-Host '输入 d 可查看完整候选与锁文件差异。' -ForegroundColor DarkGray
        } elseif ($record.Contains('gitDirty')) {
            Write-Host "Target: $($record.selected) | Git dirty: $($record.gitDirty)"
            foreach ($r in $record.runtimes) { Write-Host "  $($r.runtime) / $($r.targetId) 待回收: $(@($r.pendingCollect).Count) 冲突: $($r.conflicts) $($r.error)" }
        } elseif ($record.Contains('bindings')) {
            foreach ($r in $record.bindings) { Write-Host "  $($r.id) / $($r.targetId) / $($r.launcher) / $(Format-DisplayPath $r.gameDir)" }
            if (-not $record.bindings.Count) { Write-Host '未绑定' }
        } elseif ($record.directory) {
            Write-Host "目标: $($record.target) | 准备文件: $(@($record.files).Count)"
        } else {
            $labels=@{check='检查';target='目标';applied='已同步文件';adopted='已接管文件';unchanged='无需变更';recovery='恢复';restored='已恢复';collected='已回收';backup='备份';notice='提示';retained='保留'}
            foreach ($key in @('check','target','applied','adopted','unchanged','recovery','restored','collected','backup','notice','retained','node','pnpm','java','git','pakku')) {
                if ($record.Contains($key)) { Write-Host "$($labels[$key] ?? $key) : $(Format-DisplayPath ([string]$record[$key]))" }
            }
        }
    }
}
function Run-Mp([string[]] $Arguments) {
    Write-Host "$(Get-UiIcon wait) $($Arguments[0])" -ForegroundColor Cyan
    $result = Invoke-Mp $Arguments -Capture
    Save-Details $result.Raw
    Show-Summary $result
    if ($result.Code -ne 0) { throw "命令失败（退出码 $($result.Code)）。按 d 可查看完整日志。" }
    return $result
}
function Save-Details([string] $Text) {
    $script:LastResult=@{Raw=(@($script:LastResult.Raw,$Text) | Where-Object { $_ }) -join "`n"}
}
function Query-Mp([string[]] $Arguments) {
    $result = Invoke-Mp $Arguments -Capture
    if ($result.Code -ne 0) { $script:LastResult=$result; Show-Summary $result; throw '无法读取状态，请使用项目与环境检查。' }
    if (-not $result.Records.Count) { throw 'CLI 未返回可读取的状态。' }
    return $result.Records[-1]
}
function Refresh-Selection {
    $script:State = Query-Mp @('status','--light','--json')
    $script:Targets = @($script:State.targets)
    $script:Bindings = @($script:State.bindings)
    $script:TargetChoice = $script:State.selected
    $available = @($script:Bindings | Where-Object targetId -EQ $script:TargetChoice)
    if ($script:RuntimeChoice -notin @($available.id)) { $script:RuntimeChoice = $null }
    if (-not $script:RuntimeChoice -and $available.Count -eq 1) { $script:RuntimeChoice = $available[0].id }
}
function Choose-Item($Items, [string] $Label) {
    if (-not $Items.Count) { throw "没有可选的 $Label。" }
    while ($true) {
        Show-Page "$(Get-UiIcon list) 选择 $Label"
        for ($i=0; $i -lt $Items.Count; $i++) { Write-MenuLine "  [$($i+1)] $(Get-UiIcon build) $($Items[$i].id)  $($Items[$i].launcher)" }
        Write-MenuLine "`n  [0] $(Get-UiIcon back) 返回"
        $choice=Read-Choice "$Label（0 返回）"
        if ($choice -eq '0') { return $null }
        $number=0
        if ([int]::TryParse($choice,[ref]$number) -and $number -ge 1 -and $number -le $Items.Count) { return $Items[$number-1].id }
        Write-Host '请输入列表中的编号。' -ForegroundColor Yellow
    }
}
function Select-Target {
    $id=Choose-Item $script:Targets 'Target'
    if ($id) { $null=Run-Mp @('use',$id); Refresh-Selection; Write-Host "$(Get-UiIcon target) 当前目标: $id" }
}
function Require-Target {
    Refresh-Selection
    if (-not $script:TargetChoice) { Select-Target }
    if (-not $script:TargetChoice) { throw '未选择 Target。' }
}
function Select-Runtime {
    Require-Target
    $available=@($script:Bindings | Where-Object targetId -EQ $script:TargetChoice)
    $id=Choose-Item $available 'Runtime'
    if ($id) { $script:RuntimeChoice=$id; Write-Host "$(Get-UiIcon runtime) 当前实例: $id | 启动器: $(($available | Where-Object id -EQ $id).launcher)" }
}
function Runtime-Arguments([string] $Command) {
    Require-Target
    if (-not $script:RuntimeChoice) { Select-Runtime }
    if (-not $script:RuntimeChoice) { throw '未绑定或未选择 Runtime，请先绑定测试实例。' }
    return ,@($Command,$script:RuntimeChoice,'--target',$script:TargetChoice)
}
function Confirm-Stopped { return Confirm-Action '确认游戏已关闭，操作结束前不会启动，并执行上述写入？' }
function Invoke-Development([string] $Choice) {
    if ($Choice -eq '2') { Select-Runtime; return }
    if ($Choice -eq '1') { Select-Target; return }
    if ($Choice -eq '6') {
        Write-MenuLine '  [1] PCL2'
        Write-MenuLine '  [2] HMCL'
        Write-MenuLine '  [0] 返回'
        $launcher=Read-Choice '选择启动器'
        if ($launcher -eq '0') { return }
        if ($launcher -notin @('1','2')) { throw '请选择 PCL2 或 HMCL。' }
        Invoke-Runtimes $(if ($launcher -eq '1') { '2' } else { '3' }); return
    }
    if ($Choice -eq '7') { Invoke-Runtimes '1'; return }
    if ($Choice -eq '8') { Invoke-Runtimes '5'; return }
    $command=if ($Choice -eq '5') { 'recover' } else { 'dev' }
    $forward=Runtime-Arguments $command
    if ($Choice -eq '5') { if (Confirm-Stopped) { $null=Run-Mp ($forward+@('--stopped')) }; return }
    $null=Run-Mp @('prepare','--target',$script:TargetChoice)
    if (Confirm-Action '是否接管内容完全相同的已有文件？不同内容仍会拒绝') { $forward+= '--adopt-existing' }
    $null=Run-Mp ($forward+@('--dry-run'))
    if ($Choice -eq '3' -and (Confirm-Stopped)) { $null=Run-Mp ($forward+@('--stopped')) }
}
function Invoke-Mods([string] $Choice) {
    Require-Target
    if ($Choice -in @('1','2','3','4','5')) {
        $command=@{'1'='add';'2'='remove';'3'='update';'4'='update';'5'='list'}[$Choice]
        $forward=@($command,'--target',$script:TargetChoice)
        if ($Choice -in @('1','2','3')) { $forward+=Read-Required 'Mod slug / 项目 ID' }
        if ($Choice -ne '5' -and -not (Confirm-Action "确认 $command 当前目标的依赖（不指定项目的 update 会更新全部）？")) { return }
        # Pakku's own interaction remains attached to the terminal.
        $code=Invoke-Mp $forward
        if ($code -ne 0) { throw "Pakku 操作失败（退出码 $code）。" }
    } elseif ($Choice -eq '6') {
        $forward=Runtime-Arguments 'deps-review'
        $operation=Read-Required '候选操作 add 或 remove'
        if ($operation -notin @('add','remove')) { throw '仅支持 add 或 remove。' }
        $project=Read-Required '已核实来源的项目 ID / slug'
        if (-not (Confirm-Action '生成完整 Pakku 候选副本（可能联网并写入 .work）？')) { return }
        $result=Run-Mp ($forward+@('--operation',$operation,'--project',$project))
        $candidate=$result.Records | Where-Object { $_.projectPath } | Select-Object -Last 1
        if (-not $candidate) { throw '没有可接受的候选。' }
        if (Confirm-Action '接受此候选写入正式源？输入 d 可审查锁文件差异') {
            $null=Run-Mp ((Runtime-Arguments 'deps-accept')+@('--candidate',$candidate.id,'--accept-hash',$candidate.hash,'--confirm'))
        }
    } elseif ($Choice -eq '7') {
        $forward=Runtime-Arguments 'restore-deps'
        $file=Read-Choice '可选：额外/禁用 JAR 的相对路径（留空只恢复受管依赖，0 取消）'
        if ($file -eq '0') { return }; if ($file) { $forward+=@('--file',$file) }
        $null=Run-Mp $forward
        if (Confirm-Stopped) { $null=Run-Mp ($forward+@('--confirm','--stopped')) }
    } elseif ($Choice -eq '8') {
        $forward=Runtime-Arguments 'import-deps'
        $result=Run-Mp ($forward+@('--json'))
        $report=$result.Records[-1]
        if (-not $report.candidates.Count) { Write-Host "$(Get-UiIcon info) 没有需要识别的新增 JAR。"; return }
        $items=Select-Multiple $report.candidates "$(Get-UiIcon import) 选择要导入的依赖"
        if (-not $items.Count) { Write-Host "$(Get-UiIcon info) 未选择依赖，未导入。"; return }
        $selection=[IO.Path]::GetTempFileName()
        try {
            $payload=@($items | ForEach-Object { @{path=$_.path;hash=$_.hash} })
            [IO.File]::WriteAllText($selection,(ConvertTo-Json -InputObject $payload -Depth 5),[Text.UTF8Encoding]::new($false))
            Write-Host "$(Get-UiIcon wait) 正在批量识别 $($items.Count) 个 JAR，并校验统一候选；可能需要联网。" -ForegroundColor Cyan
            $result=Run-Mp ($forward+@('--selection',$selection,'--json'))
        } finally { Remove-Item -LiteralPath $selection -Force -ErrorAction SilentlyContinue }
        $candidate=$result.Records[-1]
        if ($candidate.blocked) { $script:OperationWarning=$true; Write-Host "$(Get-UiIcon warn) 本批未导入，请排除异常项后重新选择。"; return }
        if (-not $candidate.projectPath -or -not $candidate.hash) { Write-Host "$(Get-UiIcon info) 没有待导入依赖。"; return }
        if (Confirm-Action '确认上述全部新增依赖及许可，一次性导入项目？输入 d 查看完整差异') {
            $null=Run-Mp ($forward+@('--candidate',$candidate.id,'--accept-hash',$candidate.hash,'--confirm','--json'))
            Write-Host "$(Get-UiIcon import) 已一次性导入 $($candidate.pending) 个 Project；可用 git diff 检查。"
        } else { Write-Host "$(Get-UiIcon info) 已取消导入，正式源未修改。" }
    }
}
function Invoke-Runtimes([string] $Choice) {
    if ($Choice -eq '1') { $null=Run-Mp @('runtimes'); return }
    if ($Choice -eq '4') { Select-Runtime; return }
    if ($Choice -eq '5') {
        Refresh-Selection; $id=Choose-Item $script:Bindings '要解除的实例'
        if ($id -and (Confirm-Action "解除 $id 的绑定？游戏文件和备份保留")) { $null=Run-Mp @('unbind',$id); Refresh-Selection }; return
    }
    Require-Target
    Write-Host "绑定到 Target: $script:TargetChoice（如需切换，先在开发环境与实例中切换目标）"
    $name=Read-RuntimeId
    $gameDir=Read-Required '实际游戏目录（绝对路径，不需要额外引号）'
    $versionDir=Read-Choice '版本 JSON 所在目录（相同时留空，0 取消）'
    if ($versionDir -eq '0') { return }
    $launcher=if ($Choice -eq '2') { 'pcl2' } else { 'hmcl' }
    $forward=@('bind',$name,'--launcher',$launcher,'--target',$script:TargetChoice,'--game-dir',$gameDir)
    if ($versionDir) { $forward+=@('--version-dir',$versionDir) }
    $null=Run-Mp ($forward+@('--dry-run'))
    if (Confirm-Action '版本和实际游戏目录正确，保存绑定？') {
        $null=Run-Mp ($forward+@('--confirm-game-dir')); $script:RuntimeChoice=$name
    }
}
function Invoke-Collect([string] $Choice) {
    $forward=Runtime-Arguments 'collect'
    if ($Choice -eq '1') { $null=Run-Mp ((Runtime-Arguments 'changes')+@('--json')); return }
    $result=Run-Mp ($forward+@('--json'))
    $report=$result.Records[-1]
    if ($Choice -eq '5') { Show-Rows $report.dependencies; return }
    if ($Choice -eq '4') { foreach ($item in $report.candidates) { Write-Host (Format-DisplayPath $item.path) }; return }
    $items=@($report.managed)+@($report.candidates)
    if ($Choice -eq '2') {
        $file=Read-Required '要查看的相对路径，例如 config/example.json'
        $item=$items | Where-Object path -CEQ $file | Select-Object -First 1
        if (-not $item) { throw '该路径不在配置变更或新增候选中。' }
        Write-Host ($item.diff.text ?? $item.diff.description ?? '文件无文本差异。'); return
    }
    Write-Host '仅列出可回收文件；冲突需要先人工合并，二进制文件不自动回收。'
    $selected=Select-Multiple @($items | Where-Object { $_.state -in @('runtime-only','candidate') -and -not $_.binary -and -not $_.diff.binary }) "$(Get-UiIcon import) 选择要回收的配置"
    $completed=0
    try {
        foreach ($item in $selected) {
            $file=$item.path; $writeArgs=$forward+@('--file',$file)
            Write-Host "$(Get-UiIcon file) $(Format-DisplayPath $file) → $(Format-DisplayPath $item.source) | $($item.state)"
            if ($item.state -eq 'candidate') {
                Write-MenuLine "  [1] $(Get-UiIcon client) 客户端覆盖`n  [2] $(Get-UiIcon build) 公共覆盖`n  [0] $(Get-UiIcon back) 跳过此文件"
                $location=Read-Choice '选择新增配置来源'
                if ($location -eq '0') { continue }
                $prefix=@{'1'='.pakku/client-overrides/';'2'='.pakku/overrides/'}[$location]
                if (-not $prefix) { throw '来源选择无效。' }
                $writeArgs+=@('--source',($prefix+$file)); Write-Host "写入源位置: $(Format-DisplayPath ($prefix+$file))"
            } elseif ($null -eq $item.runtime) {
                if (-not (Confirm-Action "单独确认删除正式源文件 $($item.source)？")) { continue }
                $writeArgs+='--delete'
            }
            if (Confirm-Stopped) { $null=Run-Mp ($writeArgs+@('--confirm','--stopped')); $completed++ }
        }
    } finally { Write-Host "$(Get-UiIcon import) 回收完成 $completed / $($selected.Count) 项。已完成项保留，可用 git diff 检查。" }
}
function Invoke-Builds([string] $Choice) {
    if ($Choice -eq '2') { Refresh-Selection } else { Require-Target }
    if ($Choice -eq '3') {
        $directory=Join-Path $PSScriptRoot "dist/$script:TargetChoice"
        $latest=Get-ChildItem -LiteralPath $directory -Filter build-report.json -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $latest) { $script:OperationWarning=$true; Write-Host "$(Get-UiIcon warn) 当前目标还没有本地构建结果。" -ForegroundColor Yellow; return }
        $report=Get-Content -LiteralPath $latest.FullName -Raw | ConvertFrom-Json -AsHashtable
        $report.output=$latest.DirectoryName; $report.target=$report.targetId
        Save-Details ($report | ConvertTo-Json -Depth 20)
        Show-Summary @{Code=0;Records=@($report);Messages=@()}; return
    }
    $ids=if ($Choice -eq '2') { @($script:Targets.id) } else { @($script:TargetChoice) }
    $failed=@()
    foreach ($id in $ids) {
        try { $null=Run-Mp @('build','--target',$id) } catch { Write-Host $_.Exception.Message -ForegroundColor Red; $failed+=$id }
    }
    if ($failed.Count) { throw "构建失败: $($failed -join ', ')" }
}
function Invoke-Apply([string] $Choice) {
    $forward=Runtime-Arguments 'apply'
    if ($Choice -eq '1') { $forward+=@('--file',(Read-Required 'MRPACK 路径（同目录需要报告和 SHA256SUMS）')) }
    else {
        $forward+=@('--repo',(Read-Required 'GitHub 仓库 owner/repository'))
        if ($Choice -eq '2') { $forward+=@('--run',(Read-Required 'Actions Run ID')) }
        else { $forward+=@('--release',(Read-Required 'Release Tag')) }
        Write-Host '预览会联网读取包，不写入游戏目录。'
    }
    if (Confirm-Action '是否接管内容完全相同的已有文件？') { $forward+='--adopt-existing' }
    $result=Run-Mp $forward
    $source=$result.Records | Where-Object { $_.action -eq 'apply' } | Select-Object -Last 1
    if (-not $source.provenance.packageHash) { throw '没有可确认的包哈希，停止应用。' }
    if (Confirm-Stopped) { $null=Run-Mp ($forward+@('--sha256',$source.provenance.packageHash,'--confirm','--stopped')) }
}
function Invoke-Checks([string] $Choice) {
    $forward=switch ($Choice) {
        '1' { Require-Target; @('check','--target',$script:TargetChoice) }
        '2' { @('check','--all') }
        '3' { @('doctor') }
        '4' { @('bootstrap') }
        '5' { @('status','--json') }
    }
    if ($forward) { $null=Run-Mp $forward }
}
# Capture NUL-delimited Git output without PowerShell's line conversion.
function Read-Git([string[]] $Arguments) {
    $start=[Diagnostics.ProcessStartInfo]::new()
    # -CommandType may return several PATH matches; ProcessStartInfo needs one executable.
    $start.FileName=(Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $start.WorkingDirectory=$PSScriptRoot; $start.UseShellExecute=$false
    $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    $start.StandardOutputEncoding=[Text.Encoding]::UTF8
    foreach ($arg in $Arguments) { $start.ArgumentList.Add($arg) }
    $process=[Diagnostics.Process]::Start($start)
    try {
        $outTask=$process.StandardOutput.ReadToEndAsync(); $errTask=$process.StandardError.ReadToEndAsync()
        $process.WaitForExit(); $output=$outTask.GetAwaiter().GetResult(); $errorText=$errTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { Save-Details $errorText; throw "Git 失败：$(Format-DisplayPath $errorText)" }
        return $output
    } finally { $process.Dispose() }
}
function Read-GitFiles {
    $raw=Read-Git @('status','--porcelain=v1','-z','--untracked-files=all')
    $parts=$raw.Split([char]0); $items=@()
    for ($i=0; $i -lt $parts.Length; $i++) {
        if (-not $parts[$i]) { continue }
        $state=$parts[$i].Substring(0,2); $name=$parts[$i].Substring(3); $paths=@($name)
        if ($state -match '[RC]') { $paths+= $parts[++$i] }
        if ($state -match 'U' -or $state -in @('AA','DD')) { throw '存在未解决的 Git 合并冲突，请先在编辑器中处理。' }
        $items+=@{path=$name;paths=$paths;state=$state;staged=($state[0] -notin @(' ','?'))}
    }
    return ,$items
}
function Invoke-Git([string] $Choice) {
    if ($Choice -eq '4') {
        $output=@(& $script:Pnpm.Source run lint:commits 2>&1); Save-Details ($output -join "`n")
        if ($LASTEXITCODE -ne 0) { throw '提交信息校验失败，按 d 查看详情。' }
        Write-Host "$(Get-UiIcon ok) 提交信息校验通过。"; return
    }
    if ($Choice -eq '2') {
        Save-Details (Read-Git @('--no-pager','diff','--no-ext-diff'))
        Save-Details (Read-Git @('--no-pager','diff','--cached','--no-ext-diff'))
        Write-Host (Read-Git @('diff','--stat')); Write-Host (Read-Git @('diff','--cached','--stat'))
        Write-Host "$(Get-UiIcon file) 完整差异已保留，返回后按 d 查看。"; return
    }
    $items=Read-GitFiles
    Save-Details ($items | ConvertTo-Json -Depth 5)
    if ($Choice -eq '1') {
        Write-Host "$(Get-UiIcon git) 变化文件: $($items.Count) | 已暂存: $(@($items | Where-Object staged).Count)"
        foreach ($item in $items) { Write-Host "  $($item.state) $(Format-DisplayPath $item.path)" }; return
    }
    $selected=Select-Multiple $items "$(Get-UiIcon git) 选择需要暂存的文件（包含该文件全部修改）"
    if (-not $selected.Count) { Write-Host "$(Get-UiIcon info) 未选择文件，暂存区保持原样。"; return }
    $paths=@($selected | ForEach-Object { $_.paths })
    if ($Choice -eq '3' -and @($items | Where-Object { $_.staged -and $_.path -cnotin $selected.path }).Count) {
        throw '暂存区包含未选中的文件。请一并选择，或先在编辑器中调整暂存区；本次未暂存或提交。'
    }
    # Already-staged deletions/renames have no old index path left for git add.
    $stagePaths=@($selected | Where-Object { $_.state[1] -ne ' ' } | ForEach-Object { $_.path })
    # Literal pathspecs and NUL records preserve spaces, Unicode and special filenames.
    $pathFile=Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
    try {
        if ($stagePaths.Count) {
            [IO.File]::WriteAllText($pathFile,($stagePaths -join [char]0)+[char]0,[Text.UTF8Encoding]::new($false))
            $null=Read-Git @('--literal-pathspecs','add',"--pathspec-from-file=$pathFile",'--pathspec-file-nul')
        }
    } finally { Remove-Item -LiteralPath $pathFile -Force -ErrorAction SilentlyContinue }
    Write-Host "$(Get-UiIcon ok) 已暂存 $($selected.Count) 个文件。"
    Save-Details (Read-Git @('--no-pager','diff','--cached','--no-ext-diff'))
    if ($Choice -eq '3') {
        # Recheck the index before opening cz-git; preserve any unrelated staged work.
        $staged=@((Read-Git @('diff','--cached','--name-only','--no-renames','-z')).Split([char]0) | Where-Object { $_ })
        if (@($staged | Where-Object { $_ -cnotin $paths }).Count) { throw '暂存区出现未选择的文件，已停止提交。请检查 Git 状态。' }
        if (-not $staged.Count) { Write-Host "$(Get-UiIcon info) 没有需要提交的变化。"; return }
        & $script:Pnpm.Source run commit
        if ($LASTEXITCODE -ne 0) { throw '提交未完成，已暂存文件保留。' }
    }
}
function Invoke-CreateProject([string] $Choice) {
    $forward=@('create-target')
    if ($Choice -eq '2') {
        $file=Read-Required '本地 MRPACK 路径'
        $inspection=Run-Mp @('inspect-pack','--file',$file)
        if (@($inspection.Records[-1].issues).Count) { Write-Host '请先处理上述无法转换内容，再重新导入。'; return }
    }
    $name=Read-Required '工程名称'
    $id=Read-Required '新 Target ID，例如 my-pack-1.21.1'
    $forward+=@($id,'--name',$name)
    if ($Choice -eq '1') {
        $mc=Read-Required 'Minecraft 版本，例如 1.21.1'
        Write-MenuLine '  [1] Fabric  [2] NeoForge  [3] Forge  [4] Quilt  [0] 取消'
        $loader=@{'1'='fabric';'2'='neoforge';'3'='forge';'4'='quilt'}[(Read-Required '选择 Loader')]
        if (-not $loader) { throw 'Loader 选择无效。' }
        $loaderVersion=Read-Required 'Loader 版本'
        $forward+=@('--mc',$mc,'--loader',$loader,'--loader-version',$loaderVersion)
        Write-MenuLine '  [1] Modrinth  [2] CurseForge  [3] Multiplatform  [0] 取消'
        $platform=@{'1'='modrinth';'2'='curseforge';'3'='multiplatform'}[(Read-Required '选择发布平台')]
    } else {
        Write-Host 'MRPACK 转换目前支持 Modrinth；其他平台不能保证原文件版本一致。'
        Write-MenuLine '  [1] Modrinth  [0] 取消'
        if ((Read-Required '选择发布平台') -ne '1') { throw '发布平台选择无效。' }
        $platform='modrinth';$forward+=@('--file',$file)
        Write-Host '正在隔离目录中识别依赖并验证转换结果，可能需要联网；尚不注册 Target。'
    }
    if (-not $platform) { throw '发布平台选择无效。' }
    $forward+=@('--platform',$platform)
    $preview=Run-Mp $forward
    $candidate=$preview.Records[-1]
    if ($candidate.blocked -or -not $candidate.acceptHash) { throw '没有可确认的工程预览。' }
    if (-not (Confirm-Action '确认创建此 Pakku 工程并注册到工作区？')) { Write-Host '已取消创建，未注册 Target。'; return }
    $accept=if ($candidate.candidate) { @('create-target',$id,'--candidate',$candidate.candidate) } else { $forward }
    $null=Run-Mp ($accept+@('--accept-hash',$candidate.acceptHash,'--confirm'))
}
function Invoke-Advanced {
    Show-Page "$(Get-UiIcon tools) Pakku 高级操作" '逐个输入原生参数，空行结束；输入 0 取消。'
    Require-Target
    Write-Host 'Pakku 原生命令可能修改工程，请核对参数后确认。'
    $native=@()
    while ($true) {
        $value=Read-Choice "参数 $($native.Count+1)"
        if ($value -eq '0') { return }
        if ($value -eq '') { break }; $native+= $value
    }
    if (-not $native.Count) { return }
    Write-Host ($native | ConvertTo-Json -Compress)
    if (Confirm-Action "对 $script:TargetChoice 执行上述原生参数？") {
        $code=Invoke-Mp (@('pakku','--target',$script:TargetChoice,'--')+$native)
        if ($code -ne 0) { throw "Pakku 失败（退出码 $code）。" }
    }
}
function Show-Page([string] $Title, [string] $Description) {
    Write-Host "`n────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host '  Preliminary Art Form v2' -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host '────────────────────────────────────────────' -ForegroundColor DarkGray
    $runtimeLabel=if ($script:RuntimeChoice) { $script:RuntimeChoice } elseif (@($script:Bindings | Where-Object targetId -EQ $script:TargetChoice).Count) { '未选择' } else { '未绑定' }
    $gitState=if ($null -eq $script:State.gitDirty) { '未知' } elseif ($script:State.gitDirty) { '有未提交改动' } else { '干净' }
    Write-MenuLine "  $(Get-UiIcon target) 目标  $($script:TargetChoice ?? '未选择')"
    Write-MenuLine "  $(Get-UiIcon runtime) 实例  $runtimeLabel"
    $launcher=($script:Bindings | Where-Object id -EQ $script:RuntimeChoice | Select-Object -First 1).launcher
    Write-MenuLine "  $(Get-UiIcon launcher) 启动器  $($launcher ?? '未选择')"
    Write-MenuLine "  $(Get-UiIcon git) Git   $gitState"
    if ($Description) { Write-Host "`n  $Description" -ForegroundColor DarkGray }
    Write-Host ''
}
function Show-Menu {
    Initialize-Display
    $section=''
    $refresh=$true
    while ($true) {
        $titles=@("$(Get-UiIcon home) 主菜单","$(Get-UiIcon new) 创建整合包工程","$(Get-UiIcon dev) 开发环境与实例","$(Get-UiIcon mod) Mod 管理","$(Get-UiIcon import) 配置与变化","$(Get-UiIcon build) 构建整合包","$(Get-UiIcon apply) 应用 CI / Release 构建","$(Get-UiIcon check) 项目与环境检查","$(Get-UiIcon git) Git 提交","$(Get-UiIcon tools) Pakku 高级操作")
        $hints=@('输入编号进入功能页。','创建独立 Pakku Target，不安装游戏或绑定 Runtime。','选择整合包目标、管理测试实例并同步或恢复文件。','由 Pakku 管理依赖；修改后可检查差异。','先查看差异，再逐个回收配置文件。','构建结果保存在 dist/，可查看最近一次输出。','先预览包来源与变化，再确认写入实例。','检查源工程、工具环境和当前状态。','先暂存需要提交的文件，再打开规范提交菜单。','')
        $menus=@{
            '1'=@('新建空白工程','从已有 MRPACK 导入')
            '2'=@("$(Get-UiIcon target) 切换整合包目标（Target）","$(Get-UiIcon runtime) 切换测试实例（Runtime）","$(Get-UiIcon dev) 同步到测试实例","$(Get-UiIcon preview) 预览同步变化","$(Get-UiIcon recover) 恢复未完成的同步","$(Get-UiIcon bind) 绑定启动器实例","$(Get-UiIcon list) 查看实例信息","$(Get-UiIcon unbind) 解除实例绑定")
            '3'=@("$(Get-UiIcon add) 添加 Mod","$(Get-UiIcon remove) 删除 Mod","$(Get-UiIcon refresh) 更新指定 Mod","$(Get-UiIcon refresh) 更新全部 Mod","$(Get-UiIcon list) 查看 Mod 列表","$(Get-UiIcon search) 审查依赖增删","$(Get-UiIcon back) 恢复正式依赖","$(Get-UiIcon import) 从实例导入新增依赖")
            '4'=@("$(Get-UiIcon list) 查看全部变化","$(Get-UiIcon search) 查看指定文件差异","$(Get-UiIcon import) 选择配置并回收","$(Get-UiIcon new) 审查新增配置","$(Get-UiIcon mod) 检查依赖偏离")
            '5'=@("$(Get-UiIcon build) 构建当前目标","$(Get-UiIcon build) 构建所有目标","$(Get-UiIcon folder) 查看最近构建结果")
            '6'=@("$(Get-UiIcon folder) 应用本地 MRPACK","$(Get-UiIcon settings) 应用 GitHub Actions Run","$(Get-UiIcon tag) 应用 GitHub Release")
            '7'=@("$(Get-UiIcon check) 检查当前目标","$(Get-UiIcon check) 检查全部目标","$(Get-UiIcon doctor) 环境诊断","$(Get-UiIcon import) 安装 / 校验 Pakku","$(Get-UiIcon list) 查看工作区状态")
            '8'=@("$(Get-UiIcon git) 查看 Git 状态","$(Get-UiIcon search) 查看 Git Diff","$(Get-UiIcon edit) 选择文件并提交","$(Get-UiIcon check) 校验提交信息","$(Get-UiIcon import) 选择文件并暂存")
        }
        if ($refresh) {
            try { Refresh-Selection } catch { Write-Host $_.Exception.Message -ForegroundColor Yellow }
            $refresh=$false
        }
        Show-Page $titles[[int]$section] $hints[[int]$section]
        if (-not $section) {
            for ($i=1; $i -le 9; $i++) {
                if ($i -in @(1,5,7)) {
                    $group=@{1='工程与开发';5='构建与应用';7='检查与维护'}[$i]
                    Write-Host "  ── $group ──" -ForegroundColor $script:MenuColors.group
                }
                Write-MenuLine "  [$i] $($titles[$i])"
                if ($i -in @(4,6)) { Write-Host '' }
            }
        } else {
            $items=$menus[$section]
            for ($i=0; $i -lt $items.Count; $i++) {
                if ($section -eq '3' -and $i -eq 5) { Write-Host '  ── 依赖维护 ──' -ForegroundColor $script:MenuColors.group }
                if ($section -eq '2' -and $i -in @(0,2,5)) {
                    $group=@{0='当前环境';2='同步与恢复';5='实例管理'}[$i]
                    Write-Host "  ── $group ──" -ForegroundColor $script:MenuColors.group
                }
                Write-MenuLine "  [$($i+1)] $($items[$i])"
            }
        }
        Write-MenuLine "`n  [r] $(Get-UiIcon refresh) 刷新目标、实例与 Git 状态"
        Write-MenuLine "  [d] $(Get-UiIcon file) 查看上次操作的完整输出"
        Write-MenuLine "  [s] $(Get-UiIcon settings) 显示设置"
        $backLabel=if ($section) { '返回上一级' } else { '退出' }
        Write-MenuLine "  [0] $(Get-UiIcon back) $backLabel`n"
        $choice=Read-Choice '请选择'
        if ($choice -eq '0') { if (-not $section) { return }; $section=''; continue }
        if ($choice -eq 's') { Show-DisplaySettings; continue }
        if ($choice -eq 'r') { $refresh=$true; continue }
        if ($choice -eq 'd') { Invoke-MenuOperation -KeepDetails { Write-Host ($script:LastResult.Raw ?? '暂无操作输出。') }; continue }
        try {
            if (-not $section) {
                if ($choice -eq '9') { $refresh=$true; Invoke-MenuOperation { Invoke-Advanced } }
                elseif ($menus.ContainsKey($choice)) { $section=$choice }
                else { Write-Host '请输入菜单编号。' -ForegroundColor Yellow }
                continue
            }
            $number=0
            if (-not [int]::TryParse($choice,[ref]$number) -or $number -lt 1 -or $number -gt $menus[$section].Count) { Write-Host '请输入菜单编号。' -ForegroundColor Yellow; continue }
            $refresh=$true
            Invoke-MenuOperation { switch ($section) {
                '1' { Invoke-CreateProject $choice }; '2' { Invoke-Development $choice }; '3' { Invoke-Mods $choice }
                '4' { Invoke-Collect $choice }; '5' { Invoke-Builds $choice }; '6' { Invoke-Apply $choice }
                '7' { Invoke-Checks $choice }; '8' { Invoke-Git $choice }
            } }
        } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
    }
}

$exitCode=0
Push-Location -LiteralPath $PSScriptRoot
try {
    if ($script:EntryArguments.Count -and $script:EntryArguments[0] -in @('help','--help','-h')) { Show-Help }
    else {
        Initialize-Tools
        if ($script:EntryArguments.Count) {
            $forward=Convert-DirectArguments $script:EntryArguments
            # Stream child output to the terminal; only the final integer is the exit code.
            $global:LASTEXITCODE=0
            Invoke-Mp $forward | ForEach-Object { if ($_ -is [int]) { $script:exitCode=$_ } else { Write-Output $_ } }
        } else { Show-Menu }
    }
} catch { Write-Host "错误: $($_.Exception.Message)" -ForegroundColor Red; $exitCode=1 }
finally { Pop-Location }
exit $exitCode

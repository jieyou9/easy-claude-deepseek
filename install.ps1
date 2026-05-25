<#
.SYNOPSIS
  Claude Code + cc-switch 一键无脑安装脚本 (Windows 优化版)
#>
param(
    [string]$ApiKey = "",
    [switch]$Silent = $false,
    [string]$NodePath = "",
    [string]$ProjectDir = "",
    [string]$CcInstaller = ""
)

$ErrorActionPreference = "Continue"

# 强制 UTF-8 输出编码，否则 emoji 变成 ???
chcp 65001 > $null
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 允许当前用户运行本地 ps1 脚本（只写 HKCU，不碰 HKLM，无痕化）
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force 2>$null

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "🚀 开始全自动配置 Claude Code 运行环境..." -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. 用 Electron 传过来的 node 路径设置环境
if ($NodePath -ne "" -and (Test-Path $NodePath)) {
    $nodeDir = Split-Path $NodePath -Parent
    $env:Path = "$nodeDir;$env:Path"
    $nodeVer = & $NodePath --version
    Write-Host "✅ 检测到已安装 Node.js ($nodeVer)" -ForegroundColor Green
    
    # 同目录找 npm.cmd
    $npmCandidates = @(
        (Join-Path $nodeDir "npm.cmd"),
        (Join-Path $nodeDir "npm"),
        "$env:APPDATA\npm\npm.cmd",
        "$env:APPDATA\npm\npm"
    )
    $foundNpm = $false
    foreach ($f in $npmCandidates) {
        if (Test-Path $f) {
            $npmDir = Split-Path $f -Parent
            if ($env:Path -notlike "*$npmDir*") { $env:Path = "$npmDir;$env:Path" }
            Write-Host "✅ 找到 npm: $f" -ForegroundColor Green
            $foundNpm = $true
            break
        }
    }
    if (-not $foundNpm) {
        Write-Host "⚠️ node 目录下未找到 npm，尝试全盘搜索..." -ForegroundColor Yellow
        $found = Get-ChildItem -Path "$env:SystemDrive\" -Filter "npm.cmd" -Recurse -ErrorAction SilentlyContinue -Depth 4 | Select -First 1
        if ($found) {
            $d = $found.DirectoryName
            if ($env:Path -notlike "*$d*") { $env:Path = "$d;$env:Path" }
            Write-Host "✅ 找到 npm: $($found.FullName)" -ForegroundColor Green
        } else {
            Write-Host "❌ 完全找不到 npm！请重新安装 Node.js" -ForegroundColor Red
        }
    }
} else {
    Write-Host "⏳ 未检测到 Node.js，正在自动安装..." -ForegroundColor Yellow
    Write-Host "正在从官网下载 Node.js 安装包..." -ForegroundColor Cyan
    try {
        # 下载 Node.js LTS 安装包
        $msiPath = "$env:TEMP\node-install.msi"
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi" -OutFile $msiPath -TimeoutSec 60
        Write-Host "下载完成，正在安装（可能需要几分钟）..." -ForegroundColor Cyan
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait
        Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
        # 安装后找 node
        $newNodePaths = @("$env:ProgramFiles\nodejs", "${env:ProgramFiles(x86)}\nodejs")
        $foundNode = $false
        foreach ($p in $newNodePaths) {
            if (Test-Path "$p\node.exe") {
                $env:Path = "$p;$env:Path"
                $nodeVer = & "$p\node.exe" --version
                Write-Host "✅ Node.js 安装成功 ($nodeVer)" -ForegroundColor Green
                $foundNode = $true
                # 同目录找 npm
                if (Test-Path "$p\npm.cmd") {
                    Write-Host "✅ npm 已就绪" -ForegroundColor Green
                }
                break
            }
        }
        if (-not $foundNode) { Write-Host "❌ Node.js 安装失败，请手动安装" -ForegroundColor Red }
    } catch {
        Write-Host "❌ 自动安装 Node.js 失败: $_" -ForegroundColor Red
        Write-Host "💡 请手动从 https://nodejs.org 下载安装" -ForegroundColor Yellow
    }
}

# 查找 npm 完整路径（给后续命令用）
$npmExe = "npm"
$npmFullPath = $null
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "⚠️ npm 不在 PATH 中，尝试全盘搜索..." -ForegroundColor Yellow
    $possibleNpm = @(
        "$env:ProgramFiles\nodejs\npm.cmd",
        "${env:ProgramFiles(x86)}\nodejs\npm.cmd",
        "$env:LOCALAPPDATA\fnm\nodejs\current\npm.cmd",
        "$env:LOCALAPPDATA\fnm\current\npm.cmd",
        "$env:APPDATA\npm\npm.cmd"
    )
    foreach ($f in $possibleNpm) {
        if (Test-Path $f) { $npmFullPath = $f; break }
    }
    if (-not $npmFullPath) {
        $found = Get-ChildItem -Path "$env:SystemDrive\" -Filter "npm.cmd" -Recurse -ErrorAction SilentlyContinue -Depth 4 | Select -First 1
        if ($found) { $npmFullPath = $found.FullName }
    }
    if ($npmFullPath) {
        $npmExe = $npmFullPath
        Write-Host "✅ 找到 npm: $npmFullPath" -ForegroundColor Green
        # 把目录加入 PATH
        $dir = Split-Path $npmFullPath -Parent
        if ($env:Path -notlike "*$dir*") { $env:Path = "$dir;$env:Path" }
    } else {
        Write-Host "❌ 完全找不到 npm，安装将失败" -ForegroundColor Red
    }
} else {
    $cmd = Get-Command npm
    if ($cmd.Source) { $npmFullPath = $cmd.Source; $npmExe = $cmd.Source }
    Write-Host "✅ npm 已就绪: $npmFullPath" -ForegroundColor Green
}

# 2. 优化网络：自动切换为国内淘宝镜像（防止后续安装卡死）
Write-Host "⚡ 正在优化 npm 下载速度（切换至国内镜像源）..." -ForegroundColor Cyan
& $npmExe config set registry https://registry.npmmirror.com

# 2.5 预装 better-sqlite3（给后续 API Key 写入用）
Write-Host "⏳ 预装数据库模块 better-sqlite3..." -ForegroundColor Yellow
& $npmExe install -g better-sqlite3 2>$null
if ($LASTEXITCODE -eq 0) { Write-Host "✅ better-sqlite3 已就绪" -ForegroundColor Green }
else { Write-Host "⚠️ better-sqlite3 未安装（API Key 无法自动写入）" -ForegroundColor Yellow }

# 3. 安装 cc-switch
$ccInstalled = $false

# 优先用本地安装包
if ($CcInstaller -ne "" -and (Test-Path $CcInstaller)) {
    $name = Split-Path $CcInstaller -Leaf
    Write-Host "⏳ 安装 cc-switch: $name ..." -ForegroundColor Yellow
    if ($CcInstaller -like "*.msi") {
        Start-Process msiexec.exe -ArgumentList "/i `"$CcInstaller`" /quiet /norestart" -Wait
    } else {
        Start-Process $CcInstaller -ArgumentList "/S" -Wait
    }
    Start-Sleep -Seconds 2
    # 搜 cc-switch.exe（MSI 可能没加到 PATH）
    $ccExe = $null
    $ccSearchPaths = @(
        "$env:LOCALAPPDATA\Programs\CC Switch\cc-switch.exe",
        "$env:LOCALAPPDATA\Programs\cc-switch\cc-switch.exe",
        "$env:LOCALAPPDATA\Programs\CC-Switch\cc-switch.exe",
        "$env:LOCALAPPDATA\cc-switch\cc-switch.exe",
        "$env:APPDATA\Programs\cc-switch\cc-switch.exe",
        "$env:ProgramFiles\CC-Switch\cc-switch.exe",
        "$env:ProgramFiles\CC Switch\cc-switch.exe",
        "$env:ProgramFiles\cc-switch\cc-switch.exe",
        "${env:ProgramFiles(x86)}\CC-Switch\cc-switch.exe"
    )
    foreach ($p in $ccSearchPaths) {
        if (Test-Path $p) { $ccExe = $p; break }
    }
    if (-not $ccExe) {
        Write-Host "  ⏳ 全盘搜索 cc-switch.exe..." -ForegroundColor Gray
        $found = Get-ChildItem -Path "C:\" -Filter "cc-switch.exe" -Recurse -ErrorAction SilentlyContinue | Select -First 1
        if ($found) { $ccExe = $found.FullName }
    }
    if (-not $ccExe) {
        $lines = where.exe /R "$env:ProgramFiles" "cc-switch.exe" 2>$null
        if ($LASTEXITCODE -eq 0 -and $lines) { $ccExe = $lines[0] }
    }
    if (-not $ccExe) {
        $lines = where.exe /R "$env:LOCALAPPDATA" "cc-switch.exe" 2>$null
        if ($LASTEXITCODE -eq 0 -and $lines) { $ccExe = $lines[0] }
    }
    if ($ccExe) {
        $ccDir = Split-Path $ccExe -Parent
        if ($env:Path -notlike "*$ccDir*") { $env:Path = "$ccDir;$env:Path" }
        Write-Host "✅ 找到 cc-switch: $ccExe" -ForegroundColor Green
        # 初始化数据库（循环等待，最多 15 秒）
        $dbPath = "$env:USERPROFILE\.cc-switch\cc-switch.db"
        if (-not (Test-Path $dbPath)) {
            Write-Host "⏳ 初始化 cc-switch 数据库..." -ForegroundColor Yellow
            $proc = Start-Process $ccExe -PassThru -WindowStyle Hidden
            $waited = 0
            while ($waited -lt 15 -and -not (Test-Path $dbPath)) {
                Start-Sleep -Seconds 1
                $waited++
            }
            if ($proc -and (-not $proc.HasExited)) { $proc.Kill() }
            if (Test-Path $dbPath) {
                Write-Host "✅ cc-switch 数据库已初始化（${waited}s）" -ForegroundColor Green
            } else {
                Write-Host "⚠️ 数据库未在 15 秒内创建" -ForegroundColor Yellow
            }
        }
        $ccInstalled = $true
    } else {
        Write-Host "⚠️ MSI 已执行但未找到 cc-switch.exe" -ForegroundColor Yellow
    }
}

# 没有本地包 → 尝试 npm
if (-not $ccInstalled) {
    Write-Host "⏳ 尝试从 npm 安装 cc-switch..." -ForegroundColor Yellow
    & $npmExe install -g cc-switch 2>$null
    if ($LASTEXITCODE -eq 0 -and (Get-Command cc-switch -ErrorAction SilentlyContinue)) {
        Write-Host "✅ cc-switch 安装成功 ✅" -ForegroundColor Green
        $ccInstalled = $true
    } else {
        Write-Host "⚠️ cc-switch 未安装（不影响 Claude Code 使用）" -ForegroundColor Yellow
    }
}

# 4. 安装 Claude Code
Write-Host "⏳ 正在全局安装 Claude Code (@anthropic-ai/claude-code)..." -ForegroundColor Yellow
& $npmExe install -g @anthropic-ai/claude-code
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Claude Code 安装成功 ✅" -ForegroundColor Green
} else {
    Write-Host "⚠️ Claude Code 安装失败，请检查网络后重试" -ForegroundColor Red
}

if ($Silent) {
    # 输出 node 路径供主进程读取
    try { $np = (Get-Command node).Source; Write-Host "[NODE_PATH]$np"; } catch {}
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "🎉 全部安装完成！" -ForegroundColor Green
    Write-Host "💡 在终端输入 claude 即可使用" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
} else {
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        Write-Host "=============================================" -ForegroundColor Green
        Write-Host "🎉 所有工具安装成功！" -ForegroundColor Green
        Write-Host "🛠️ 正在为您启动 cc-switch 进行环境检查或切换..." -ForegroundColor Green
        Write-Host "=============================================" -ForegroundColor Green
        Start-Sleep -Seconds 2
        cc-switch
        Write-Host "👉 接下来将为您启动 Claude Code 主程序..." -ForegroundColor Cyan
        claude
    } else {
        Write-Host "❌ 安装似乎未完全成功，请尝试用管理员身份运行此脚本。" -ForegroundColor Red
        Write-Host "   或手动运行: npm install -g @anthropic-ai/claude-code" -ForegroundColor Yellow
    }
}

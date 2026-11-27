# ai_work 集中启动
# 用法:
#   .\scripts\start.ps1              列出项目
#   .\scripts\start.ps1 -List
#   .\scripts\start.ps1 piaoqi
#   .\scripts\start.ps1 zhida
#   .\scripts\start.ps1 game_live
#   .\scripts\start.ps1 all

param(
  [Parameter(Position = 0)]
  [string]$Target = "",
  [switch]$List
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RegistryPath = Join-Path $PSScriptRoot "projects.json"
$Registry = Get-Content -Raw -Encoding UTF8 $RegistryPath | ConvertFrom-Json

function Show-Projects {
  Write-Host ""
  Write-Host "ai_work 项目注册表" -ForegroundColor Cyan
  Write-Host ("=" * 56)
  foreach ($p in $Registry.projects) {
    $ready = if ($null -ne $p.start) { "可启动" } else { "仅文档" }
    Write-Host ("[{0}] {1}  {2}" -f $p.id, $p.name, $p.slogan)
    Write-Host ("     类型:{0}  端口:{1}  状态:{2}" -f $p.type, $p.port, $ready)
    Write-Host ("     文档:{0}" -f $p.doc)
    Write-Host ("     说明:{0}" -f $p.note)
    Write-Host ""
  }
  Write-Host "示例: .\scripts\start.ps1 game_live"
  Write-Host "      .\scripts\start.ps1 all"
  Write-Host ""
}

function Start-Project($p) {
  if ($null -eq $p.start) {
    Write-Host ("[跳过] {0}（{1}）暂无本地服务，请先看文档: {2}" -f $p.name, $p.id, $p.doc) -ForegroundColor Yellow
    return
  }
  $cwd = Join-Path $Root $p.start.cwd
  $cmd = $p.start.command
  $args = @($p.start.args)
  Write-Host ("[启动] {0} → {1} {2}  (cwd={3})" -f $p.name, $cmd, ($args -join " "), $cwd) -ForegroundColor Green
  Start-Process -FilePath $cmd -ArgumentList $args -WorkingDirectory $cwd -WindowStyle Normal
}

if ($List -or [string]::IsNullOrWhiteSpace($Target)) {
  Show-Projects
  exit 0
}

$Target = $Target.Trim().ToLowerInvariant()

if ($Target -eq "all") {
  foreach ($p in $Registry.projects) {
    Start-Project $p
  }
  exit 0
}

$match = $Registry.projects | Where-Object { $_.id -eq $Target }
if (-not $match) {
  Write-Host ("未找到项目 id: {0}" -f $Target) -ForegroundColor Red
  Show-Projects
  exit 1
}

Start-Project $match

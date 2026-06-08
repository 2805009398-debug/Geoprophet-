param()

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$statePath = Join-Path $projectRoot ".codex-run-logs\local-yolo-stack\state.json"

if (-not (Test-Path $statePath)) {
  Write-Host "State file not found."
  exit 1
}

$state = Get-Content $statePath -Raw | ConvertFrom-Json

function Get-PortStatus {
  param([int]$Port)
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $Port } |
    Select-Object -First 1 LocalAddress, LocalPort, OwningProcess
}

function Get-HealthStatus {
  param([string]$Url)
  try {
    return Invoke-RestMethod -Uri $Url -TimeoutSec 5 | ConvertTo-Json -Depth 6 -Compress
  } catch {
    return $_.Exception.Message
  }
}

Write-Host "Started at:    $($state.startedAt)"
Write-Host "Model port:    $($state.modelPort)"
Write-Host "API port:      $($state.apiPort)"
Write-Host "Model root pid:$($state.modelProcess.pid)"
Write-Host "API root pid:  $($state.apiProcess.pid)"
Write-Host ""
Write-Host "Listening sockets:"
Get-PortStatus -Port ([int]$state.modelPort) | Format-List
Get-PortStatus -Port ([int]$state.apiPort) | Format-List
Write-Host ""
Write-Host "Model health:"
Write-Host (Get-HealthStatus -Url "http://127.0.0.1:$($state.modelPort)/health")
Write-Host ""
Write-Host "API health:"
Write-Host (Get-HealthStatus -Url "http://127.0.0.1:$($state.apiPort)/api/health")

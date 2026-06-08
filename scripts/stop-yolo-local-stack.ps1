param()

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$statePath = Join-Path $projectRoot ".codex-run-logs\local-yolo-stack\state.json"

function Stop-PortOwner {
  param([int]$Port)

  $connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $Port } |
    Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($ownerPid in $connections) {
    try {
      Stop-Process -Id $ownerPid -Force -ErrorAction Stop
    } catch {
    }
  }
}

function Get-DescendantProcessIds {
  param([int]$RootPid)

  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $pending = [System.Collections.Generic.Queue[int]]::new()
  $pending.Enqueue($RootPid)
  $result = New-Object System.Collections.Generic.List[int]

  while ($pending.Count -gt 0) {
    $current = $pending.Dequeue()
    foreach ($item in $all) {
      if ($item.ParentProcessId -eq $current) {
        $result.Add([int]$item.ProcessId)
        $pending.Enqueue([int]$item.ProcessId)
      }
    }
  }

  return $result
}

function Stop-ProcessTree {
  param([int]$RootPid)

  $childPids = @(Get-DescendantProcessIds -RootPid $RootPid)
  foreach ($childPid in ($childPids | Sort-Object -Descending -Unique)) {
    try {
      Stop-Process -Id $childPid -Force -ErrorAction Stop
    } catch {
    }
  }

  try {
    Stop-Process -Id $RootPid -Force -ErrorAction Stop
  } catch {
  }
}

if (-not (Test-Path $statePath)) {
  throw "State file not found: $statePath"
}

$state = Get-Content $statePath -Raw | ConvertFrom-Json
$rootPids = @()
$ports = @()

if ($state.modelProcess.pid) {
  $rootPids += [int]$state.modelProcess.pid
}
if ($state.apiProcess.pid) {
  $rootPids += [int]$state.apiProcess.pid
}
if ($state.modelPort) {
  $ports += [int]$state.modelPort
}
if ($state.apiPort) {
  $ports += [int]$state.apiPort
}

foreach ($rootPid in ($rootPids | Sort-Object -Descending -Unique)) {
  Stop-ProcessTree -RootPid $rootPid
}

Start-Sleep -Seconds 1

foreach ($port in ($ports | Sort-Object -Unique)) {
  Stop-PortOwner -Port $port
}

Remove-Item $statePath -Force -ErrorAction SilentlyContinue
Write-Host "Local YOLO stack stopped."

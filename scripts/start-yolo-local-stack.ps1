param(
  [int]$ModelPort = 8000,
  [int]$ApiPort = 3000,
  [switch]$UseCpu
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $pwshCommand) {
  $pwshCommand = Get-Command powershell.exe -ErrorAction Stop
}
$pwsh = $pwshCommand.Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$python = Join-Path $projectRoot ".venv-yolo\Scripts\python.exe"
$modelServiceRoot = Join-Path $projectRoot "model-service"
$logDir = Join-Path $projectRoot ".codex-run-logs\local-yolo-stack"
$statePath = Join-Path $logDir "state.json"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Get-ListeningPortOwner {
  param([int]$Port)
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $Port } |
    Select-Object -First 1
}

function Assert-PortFree {
  param([int]$Port, [string]$Name)
  $owner = Get-ListeningPortOwner -Port $Port
  if ($owner) {
    throw "$Name port $Port is already in use by PID $($owner.OwningProcess)."
  }
}

function Wait-HttpHealth {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-RestMethod -Uri $Url -TimeoutSec 5
      return $response
    } catch {
      Start-Sleep -Milliseconds 800
    }
  }

  throw "Timed out waiting for $Url"
}

function Start-BackgroundPowerShell {
  param(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$Command
  )

  $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $stdout = Join-Path $logDir "$Name.$timestamp.stdout.log"
  $stderr = Join-Path $logDir "$Name.$timestamp.stderr.log"
  $process = Start-Process `
    -FilePath $pwsh `
    -ArgumentList @("-NoProfile", "-Command", $Command) `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -WindowStyle Hidden `
    -PassThru

  [PSCustomObject]@{
    name = $Name
    pid = $process.Id
    stdout = $stdout
    stderr = $stderr
    startedAt = $process.StartTime
  }
}

Assert-PortFree -Port $ModelPort -Name "Model service"
Assert-PortFree -Port $ApiPort -Name "API"

$modelDevice = if ($UseCpu) { "cpu" } else { "auto" }
$yoloPath = Join-Path $projectRoot "models\yolo_landslide_from_masks\yolov8n_640\weights\best.pt"

if (-not (Test-Path $yoloPath)) {
  throw "YOLO weights not found: $yoloPath"
}

$modelCommand = @"
`$env:MODEL_DEVICE = '$modelDevice'
`$env:ALLOW_HEURISTIC_FALLBACK = 'false'
`$env:LANDSLIDE_YOLO_PATH = '$yoloPath'
`$env:LANDSLIDE_YOLO_CONF = '0.25'
`$env:LANDSLIDE_YOLO_IOU = '0.45'
`$env:LANDSLIDE_YOLO_IMGSZ = '640'
`$env:LANDSLIDE_YOLO_MAX_DET = '300'
Set-Location '$modelServiceRoot'
& '$python' -m uvicorn app.main:app --host 127.0.0.1 --port $ModelPort
"@

$apiCommand = @"
`$env:APP_MODE = 'demo'
`$env:PORT = '$ApiPort'
`$env:HOST = '127.0.0.1'
`$env:JWT_SECRET = 'geoprophet-demo-secret'
`$env:AI_INFERENCE_BASE_URL = 'http://127.0.0.1:$ModelPort'
`$env:AI_LANDSLIDE_ENDPOINT = '/predict/landslide'
`$env:AI_INFERENCE_TIMEOUT_MS = '60000'
Set-Location '$projectRoot'
& '$npm' run dev --workspace backend
"@

$modelProcess = Start-BackgroundPowerShell -Name "model-service" -WorkingDirectory $modelServiceRoot -Command $modelCommand
$modelHealth = Wait-HttpHealth -Url "http://127.0.0.1:$ModelPort/health"

$apiProcess = Start-BackgroundPowerShell -Name "backend-api" -WorkingDirectory $projectRoot -Command $apiCommand
$apiHealth = Wait-HttpHealth -Url "http://127.0.0.1:$ApiPort/api/health"

$state = [PSCustomObject]@{
  startedAt = (Get-Date).ToString("s")
  modelPort = $ModelPort
  apiPort = $ApiPort
  modelProcess = $modelProcess
  apiProcess = $apiProcess
}

$state | ConvertTo-Json -Depth 6 | Set-Content -Path $statePath -Encoding UTF8

Write-Host "Local YOLO stack is ready."
Write-Host "Model service: http://127.0.0.1:$ModelPort"
Write-Host "API:           http://127.0.0.1:$ApiPort"
Write-Host "State file:    $statePath"
Write-Host "Model health:  $($modelHealth.status)"
Write-Host "API health:    $($apiHealth.status)"

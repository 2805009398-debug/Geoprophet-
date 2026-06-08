param(
  [string]$Model = "gpt-oss:20b",
  [string]$ModelDir = "",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 11435,
  [switch]$SkipPull,
  [string]$Prompt = "Reply in Chinese with one sentence: local model is running."
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ModelDir) {
  $ModelDir = Join-Path $projectRoot "models\ollama"
}

$ollama = Get-Command ollama -ErrorAction Stop
$baseUrl = "http://$HostName`:$Port"
$env:OLLAMA_MODELS = $ModelDir
$env:OLLAMA_HOST = "$HostName`:$Port"

function Invoke-OpenAICompatibleSmokeTest {
  param(
    [string]$PromptText
  )

  $body = @{
    model = $Model
    messages = @(
      @{ role = "system"; content = "Reply in Chinese with one sentence." },
      @{ role = "user"; content = $PromptText }
    )
  } | ConvertTo-Json -Depth 5

  $response = Invoke-RestMethod `
    -Uri "$baseUrl/v1/chat/completions" `
    -Method Post `
    -ContentType "application/json" `
    -Headers @{ Authorization = "Bearer ollama" } `
    -Body $body

  $content = $response.choices[0].message.content
  if (-not $content) {
    throw "OpenAI-compatible smoke test returned empty content."
  }

  Write-Host $content
}

function Test-OllamaServer {
  try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/tags" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-OllamaServer {
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Test-OllamaServer) {
      return
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Ollama did not become ready at $baseUrl within 30 seconds."
}

New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null

Write-Host "Using Ollama model directory: $ModelDir"
Write-Host "Using Ollama host: $baseUrl"

if (-not (Test-OllamaServer)) {
  Write-Host "Starting Ollama server..."
  Start-Process -FilePath $ollama.Source -ArgumentList "serve" -WorkingDirectory $projectRoot -WindowStyle Hidden
  Wait-OllamaServer
}

if (-not $SkipPull) {
  Write-Host "Pulling $Model. This is a large download and may take a while..."
  & $ollama.Source pull $Model

  Write-Host ""
  Write-Host "Running a short CLI smoke test..."
  & $ollama.Source run $Model $Prompt

  Write-Host ""
  Write-Host "Running an OpenAI-compatible API smoke test..."
  Invoke-OpenAICompatibleSmokeTest -PromptText "Reply in Chinese with one sentence: OpenAI-compatible API is ready."
} else {
  Write-Host "Skipping model pull and smoke test."
}

Write-Host ""
Write-Host "Done."
Write-Host "Ollama API: $baseUrl"
Write-Host "OpenAI-compatible API: $baseUrl/v1"
Write-Host "Model: $Model"

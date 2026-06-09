param(
  [string]$Model = "doubao-seed-2-0-lite-260215",
  [string]$BaseUrl = "https://ark.cn-beijing.volces.com/api/v3",
  [string]$ChatEndpoint = "chat/completions"
)

$ErrorActionPreference = "Stop"

$userArkApiKey = [Environment]::GetEnvironmentVariable("ARK_API_KEY", "User")
$userVisionApiKey = [Environment]::GetEnvironmentVariable("VISION_API_KEY", "User")
$userDoubaoApiKey = [Environment]::GetEnvironmentVariable("DOUBAO_API_KEY", "User")

if (-not $env:ARK_API_KEY -and $userArkApiKey) {
  $env:ARK_API_KEY = $userArkApiKey
}

if (-not $env:VISION_API_KEY -and $userVisionApiKey) {
  $env:VISION_API_KEY = $userVisionApiKey
}

if (-not $env:DOUBAO_API_KEY -and $userDoubaoApiKey) {
  $env:DOUBAO_API_KEY = $userDoubaoApiKey
}

if (-not $env:ARK_API_KEY -and -not $env:VISION_API_KEY -and -not $env:DOUBAO_API_KEY) {
  Write-Host "Please set ARK_API_KEY in the current PowerShell session first, for example:"
  Write-Host '$env:ARK_API_KEY="your Volcengine Ark API key"'
  exit 1
}

$env:VISION_PROVIDER = "doubao"
$env:VISION_BASE_URL = $BaseUrl
$env:VISION_CHAT_ENDPOINT = $ChatEndpoint
$env:VISION_MODEL = $Model

Write-Host "Doubao vision enabled: $Model"
Write-Host "API key is read only from the current environment and is not written to project files."

$frontendPortInUse = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($frontendPortInUse) {
  Write-Host "Frontend port 5173 is already in use; reusing the existing frontend and starting backend only."
  npm run dev --workspace backend
} else {
  npm run dev
}

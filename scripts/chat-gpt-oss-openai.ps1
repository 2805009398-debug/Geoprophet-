param(
  [string]$Prompt = "请用中文简要介绍你能做什么。",
  [string]$SystemPrompt = "你是 HiCool 的本地地质灾害研判助手。",
  [string]$Model = "gpt-oss:20b",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 11435
)

$ErrorActionPreference = "Stop"
$baseUrl = "http://$HostName`:$Port"

$body = @{
  model = $Model
  messages = @(
    @{ role = "system"; content = $SystemPrompt },
    @{ role = "user"; content = $Prompt }
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
  throw "OpenAI-compatible API returned empty content."
}

Write-Output $content

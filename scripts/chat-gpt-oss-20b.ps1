param(
  [string]$Prompt = "Reply in Chinese and introduce what you can do.",
  [string]$Model = "gpt-oss:20b",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 11435
)

$ErrorActionPreference = "Stop"
$ollama = Get-Command ollama -ErrorAction Stop
$env:OLLAMA_HOST = "$HostName`:$Port"

& $ollama.Source run $Model $Prompt

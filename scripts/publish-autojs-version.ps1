param(
  [string]$ManifestPath = "",
  [string]$ApiBaseUrl = "http://106.54.41.106:18080/api/v1",
  [string]$AdminUsername = "root",
  [string]$AdminPassword = "root",
  [string]$ReleaseNote = "AutoJS script update package",
  [switch]$ForceUpdate
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $ManifestPath) {
  $projectConfig = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot "mobile-agent\autojs\project.json") | ConvertFrom-Json
  $ManifestPath = Join-Path $repoRoot ("dist\" + [string]$projectConfig.name + "-autojs-" + [string]$projectConfig.versionName + ".json")
}

if (-not (Test-Path $ManifestPath)) {
  throw "Manifest not found: $ManifestPath"
}

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestPath | ConvertFrom-Json
$baseUrl = $ApiBaseUrl.TrimEnd("/")

$loginBody = @{
  username = $AdminUsername
  password = $AdminPassword
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Method Post `
  -Uri ($baseUrl + "/admin/auth/login") `
  -ContentType "application/json; charset=utf-8" `
  -Body $loginBody

if (-not $login.token) {
  throw "Admin login did not return a token."
}

$payload = [ordered]@{
  version = [string]$manifest.version
  channel = if ($manifest.channel) { [string]$manifest.channel } else { "stable" }
  packageUrl = [string]$manifest.packageUrl
  sha256 = [string]$manifest.sha256
  entryFile = if ($manifest.entryFile) { [string]$manifest.entryFile } else { "main.js" }
  releaseNote = $ReleaseNote
  forceUpdate = [bool]$ForceUpdate
  status = if ($manifest.status) { [string]$manifest.status } else { "PUBLISHED" }
}

$body = $payload | ConvertTo-Json -Depth 4
$result = Invoke-RestMethod `
  -Method Post `
  -Uri ($baseUrl + "/admin/agent-versions") `
  -Headers @{ Authorization = "Bearer " + [string]$login.token } `
  -ContentType "application/json; charset=utf-8" `
  -Body $body

Write-Host "Agent version published:"
Write-Host ("  Version: " + $payload.version)
Write-Host ("  Channel: " + $payload.channel)
Write-Host ("  Package: " + $payload.packageUrl)
Write-Host ("  SHA256: " + $payload.sha256)
Write-Host ("  ID: " + $result.id)

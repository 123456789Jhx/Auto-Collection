param(
  [string]$ManifestPath = "",
  [string]$ApiBaseUrl = "http://localhost:3012/api/v1",
  [string]$AdminUsername = "root",
  [string]$AdminPassword = "root",
  [string]$ReleaseNote = "Business scripts hot update",
  [switch]$ForceUpdate
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$downloadDir = Join-Path $repoRoot "account-data-platform\apps\api\dist\agent"

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $latestManifest = Get-ChildItem -LiteralPath $downloadDir -Filter "AgriVideoCollector-biz-scripts-*.json" -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $latestManifest) {
    throw "Biz scripts manifest not found in $downloadDir"
  }
  $ManifestPath = $latestManifest.FullName
}
if (-not (Test-Path $ManifestPath)) {
  throw "Manifest not found: $ManifestPath"
}

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestPath | ConvertFrom-Json
if ([string]$manifest.channel -ne "biz-scripts") {
  throw "Only channel=biz-scripts can be published by this script."
}
$packagePath = Join-Path (Split-Path -Parent $ManifestPath) ([string]$manifest.fileName)
if (-not (Test-Path $packagePath)) {
  throw "Package not found: $packagePath"
}
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packagePath).Hash.ToLowerInvariant()
if ($actualHash -ne ([string]$manifest.sha256).ToLowerInvariant()) {
  throw "Package SHA256 does not match manifest."
}

function Invoke-Utf8JsonPost([string]$Uri, [object]$Payload, [string]$Authorization = "") {
  $request = [System.Net.HttpWebRequest]::Create($Uri)
  $request.Method = "POST"
  $request.ContentType = "application/json; charset=utf-8"
  if (-not [string]::IsNullOrWhiteSpace($Authorization)) {
    $request.Headers["Authorization"] = $Authorization
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($Payload | ConvertTo-Json -Depth 6))
  $request.ContentLength = $bytes.Length
  $stream = $request.GetRequestStream()
  try {
    $stream.Write($bytes, 0, $bytes.Length)
  } finally {
    $stream.Dispose()
  }
  $response = $request.GetResponse()
  try {
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
    try {
      return ($reader.ReadToEnd() | ConvertFrom-Json)
    } finally {
      $reader.Dispose()
    }
  } finally {
    $response.Dispose()
  }
}

$baseUrl = $ApiBaseUrl.TrimEnd("/")
$login = Invoke-Utf8JsonPost `
  -Uri ($baseUrl + "/admin/auth/login") `
  -Payload @{ username = $AdminUsername; password = $AdminPassword }
if (-not $login.token) {
  throw "Admin login did not return a token."
}
$headers = @{ Authorization = "Bearer " + [string]$login.token }
$versions = Invoke-RestMethod -Method Get -Uri ($baseUrl + "/admin/agent-versions") -Headers $headers
$existing = @($versions | Where-Object {
  [string]$_.channel -eq "biz-scripts" -and [string]$_.version -eq [string]$manifest.version
}) | Select-Object -First 1

if ($existing) {
  if ([string]$existing.sha256 -eq [string]$manifest.sha256 -and [string]$existing.packageUrl -eq [string]$manifest.packageUrl) {
    Write-Host "Biz scripts version already published:"
    Write-Host ("  ID: " + [string]$existing.id)
    Write-Host ("  Version: " + [string]$existing.version)
    return
  }
  throw "Version already exists with different package metadata. Use a new version."
}

$payload = [ordered]@{
  version = [string]$manifest.version
  channel = "biz-scripts"
  packageUrl = [string]$manifest.packageUrl
  sha256 = [string]$manifest.sha256
  entryFile = [string]$manifest.entryFile
  releaseNote = $ReleaseNote
  forceUpdate = [bool]$ForceUpdate
  status = "PUBLISHED"
}
$result = Invoke-Utf8JsonPost `
  -Uri ($baseUrl + "/admin/agent-versions") `
  -Payload $payload `
  -Authorization $headers.Authorization

Write-Host "Biz scripts version published:"
Write-Host ("  ID: " + [string]$result.id)
Write-Host ("  Version: " + $payload.version)
Write-Host ("  Package: " + $payload.packageUrl)
Write-Host ("  SHA256: " + $payload.sha256)

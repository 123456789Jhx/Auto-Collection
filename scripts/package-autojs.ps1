param(
  [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceDir = Join-Path $repoRoot "mobile-agent\autojs"
$distDir = Join-Path $repoRoot "dist"
$stageRoot = Join-Path $distDir "stage"
$stageDir = Join-Path $stageRoot "AgriVideoCollector"
$zipPath = Join-Path $distDir ("AgriVideoCollector-autojs-" + $Version + ".zip")
$shaPath = $zipPath + ".sha256"
$manifestPath = Join-Path $distDir ("AgriVideoCollector-autojs-" + $Version + ".json")

if (-not (Test-Path $sourceDir)) {
  throw "Source directory not found: $sourceDir"
}

if (Test-Path $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

$excludeNames = @(
  ".git",
  ".idea",
  "node_modules",
  "datasource"
)

Get-ChildItem -Path $sourceDir -Force | ForEach-Object {
  if ($excludeNames -contains $_.Name) {
    return
  }
  Copy-Item -LiteralPath $_.FullName -Destination $stageDir -Recurse -Force
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
if (Test-Path $shaPath) {
  Remove-Item -LiteralPath $shaPath -Force
}
if (Test-Path $manifestPath) {
  Remove-Item -LiteralPath $manifestPath -Force
}

Compress-Archive -Path (Join-Path $stageRoot "AgriVideoCollector") -DestinationPath $zipPath -Force
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
$fileName = Split-Path -Leaf $zipPath
Set-Content -LiteralPath $shaPath -Encoding ASCII -Value "$hash  $fileName"

$manifest = [ordered]@{
  version = $Version
  channel = "stable"
  fileName = $fileName
  packageUrl = "http://106.54.41.106:18080/downloads/agent/$fileName"
  sha256 = $hash
  entryFile = "main.js"
  forceUpdate = $false
  status = "PUBLISHED"
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Package created:"
Write-Host $zipPath
Write-Host "SHA256:"
Write-Host $hash
Write-Host "Manifest:"
Write-Host $manifestPath

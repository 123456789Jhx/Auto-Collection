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
  "node_modules"
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

Compress-Archive -Path (Join-Path $stageRoot "AgriVideoCollector") -DestinationPath $zipPath -Force

Write-Host "Package created:"
Write-Host $zipPath

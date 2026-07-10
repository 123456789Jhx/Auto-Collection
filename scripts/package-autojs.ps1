param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceDir = Join-Path $repoRoot "mobile-agent\autojs"
$distDir = Join-Path $repoRoot "dist"
$stageRoot = Join-Path $distDir "stage"
$stageDir = Join-Path $stageRoot "AgriVideoCollector"

if (-not (Test-Path $sourceDir)) {
  throw "Source directory not found: $sourceDir"
}

$projectConfig = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $sourceDir "project.json") | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = [string]$projectConfig.versionName
}
if ([string]::IsNullOrWhiteSpace($Version)) {
  throw "Version is required and project.json versionName is empty."
}

function Get-ConfigBoolean([object]$Value, [string]$Name, [bool]$DefaultValue) {
  if ($null -eq $Value) {
    return $DefaultValue
  }
  $property = $Value.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) {
    return $DefaultValue
  }
  return [System.Convert]::ToBoolean($property.Value)
}

$excludeTests = Get-ConfigBoolean -Value $projectConfig.optimization -Name "excludeTests" -DefaultValue $true

$zipPath = Join-Path $distDir ("AgriVideoCollector-autojs-" + $Version + ".zip")
$shaPath = $zipPath + ".sha256"
$manifestPath = Join-Path $distDir ("AgriVideoCollector-autojs-" + $Version + ".json")

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
if ($excludeTests) {
  $excludeNames += "tests"
}

Get-ChildItem -Path $sourceDir -Force | ForEach-Object {
  if ($excludeNames -contains $_.Name) {
    return
  }
  Copy-Item -LiteralPath $_.FullName -Destination $stageDir -Recurse -Force
}

$registrationSecret = [string]$env:MOBILE_REGISTRATION_SECRET
if ([string]::IsNullOrWhiteSpace($registrationSecret)) {
  throw "MOBILE_REGISTRATION_SECRET is required for mobile agent packages."
}

$configPath = Join-Path $stageDir "config.js"
if (-not (Test-Path $configPath)) {
  throw "Config file not found in staged package: $configPath"
}
$escapedSecret = $registrationSecret.Replace("\", "\\").Replace('"', '\"')
$escapedVersion = $Version.Replace("\", "\\").Replace('"', '\"')
$configText = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath
$registrationSecretPattern = '(registrationSecret\s*:\s*)".*?"'
if (-not [regex]::IsMatch($configText, $registrationSecretPattern)) {
  throw "registrationSecret field not found in staged config: $configPath"
}
$patchedConfigText = [regex]::Replace(
  $configText,
  $registrationSecretPattern,
  '${1}"' + $escapedSecret + '"',
  1
)
$appVersionPattern = '(?s)(app\s*:\s*\{.*?version\s*:\s*)".*?"'
if (-not [regex]::IsMatch($patchedConfigText, $appVersionPattern)) {
  throw "app.version field not found in staged config: $configPath"
}
$versionPatchedConfigText = [regex]::Replace(
  $patchedConfigText,
  $appVersionPattern,
  '${1}"' + $escapedVersion + '"',
  1
)
$patchedConfigText = $versionPatchedConfigText
Set-Content -LiteralPath $configPath -Encoding UTF8 -Value $patchedConfigText

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

param(
  [string]$Version = "",
  [string]$PackageBaseUrl = "http://localhost:3012/downloads/agent",
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceRoot = Join-Path $repoRoot "mobile-agent\autojs"
$projectPath = Join-Path $sourceRoot "project.json"
$project = Get-Content -Raw -Encoding UTF8 -LiteralPath $projectPath | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = [string]$project.versionName
}
if ([string]::IsNullOrWhiteSpace($Version)) {
  throw "Biz script version is required."
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $repoRoot "account-data-platform\dist\agent"
}

$roots = @("features", "domain")
foreach ($rootName in $roots) {
  if (-not (Test-Path (Join-Path $sourceRoot $rootName))) {
    throw "Biz script source directory not found: $rootName"
  }
}

function Convert-ToEncodedPath([string]$Path) {
  return (($Path.Replace("\", "/").Split("/") | ForEach-Object {
    [Uri]::EscapeDataString($_)
  }) -join "/")
}

function Add-DeterministicZipEntry(
  [System.IO.Compression.ZipArchive]$Archive,
  [string]$SourcePath,
  [string]$EntryName
) {
  $entry = $Archive.CreateEntry($EntryName.Replace("\", "/"), [System.IO.Compression.CompressionLevel]::Optimal)
  $entry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
  $input = [System.IO.File]::OpenRead($SourcePath)
  $output = $entry.Open()
  try {
    $input.CopyTo($output)
  } finally {
    $output.Dispose()
    $input.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stageDir = Join-Path $repoRoot "dist\biz-scripts-stage"
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

$baseName = "AgriVideoCollector-biz-scripts-$Version"
$zipPath = Join-Path $OutputDir "$baseName.zip"
$manifestPath = Join-Path $OutputDir "$baseName.json"
$shaPath = Join-Path $OutputDir "$baseName.zip.sha256"
$embeddedManifestPath = Join-Path $stageDir "biz-script-manifest.json"
$entryFile = "biz-script-manifest.json"

$sourceFiles = @()
foreach ($rootName in $roots) {
  $sourceFiles += Get-ChildItem -LiteralPath (Join-Path $sourceRoot $rootName) -Recurse -File
}
$sourceFiles = $sourceFiles | Sort-Object FullName
if ($sourceFiles.Count -eq 0) {
  throw "No business scripts found."
}

$manifestFiles = @($sourceFiles | ForEach-Object {
  $relativePath = $_.FullName.Substring($sourceRoot.Length).TrimStart("\", "/").Replace("\", "/")
  if ($relativePath -eq "config.js" -or -not ($relativePath.StartsWith("features/") -or $relativePath.StartsWith("domain/"))) {
    throw "Unsafe business script path: $relativePath"
  }
  [ordered]@{
    path = Convert-ToEncodedPath $relativePath
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
  }
})

$embeddedManifest = [ordered]@{
  version = $Version
  channel = "biz-scripts"
  files = $manifestFiles
  entryFile = $entryFile
}
$embeddedManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $embeddedManifestPath -Encoding UTF8

foreach ($path in @($zipPath, $manifestPath, $shaPath)) {
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Force
  }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($sourceFile in $sourceFiles) {
    $entryName = $sourceFile.FullName.Substring($sourceRoot.Length).TrimStart("\", "/").Replace("\", "/")
    Add-DeterministicZipEntry -Archive $archive -SourcePath $sourceFile.FullName -EntryName $entryName
  }
  Add-DeterministicZipEntry -Archive $archive -SourcePath $embeddedManifestPath -EntryName $entryFile
} finally {
  $archive.Dispose()
}

$zipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
$zipFileName = Split-Path -Leaf $zipPath
$encodedZipName = Convert-ToEncodedPath $zipFileName
$externalManifest = [ordered]@{
  version = $Version
  channel = "biz-scripts"
  files = $manifestFiles
  entryFile = $entryFile
  fileName = $zipFileName
  packageUrl = $PackageBaseUrl.TrimEnd("/") + "/" + $encodedZipName
  sha256 = $zipHash
  status = "PUBLISHED"
}
$externalManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Set-Content -LiteralPath $shaPath -Encoding ASCII -Value "$zipHash  $zipFileName"
Remove-Item -LiteralPath $embeddedManifestPath -Force

Write-Host "Biz scripts package created:"
Write-Host $zipPath
Write-Host "Manifest:"
Write-Host $manifestPath
Write-Host "SHA256:"
Write-Host $zipHash

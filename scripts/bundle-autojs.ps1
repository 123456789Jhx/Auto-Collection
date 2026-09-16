param(
  [string]$Version = "",
  [string]$PackageBaseUrl = "",
  [string]$OutputDir = "",
  [string[]]$Files = $null,
  [string]$BaseVersion = "",
  [string]$BaseManifestPath = "",
  [string]$BaselineManifestPath = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "biz-script-manifest.ps1")
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceRoot = Join-Path $repoRoot "mobile-agent\autojs"
$projectPath = Join-Path $sourceRoot "project.json"
$project = Get-Content -Raw -Encoding UTF8 -LiteralPath $projectPath | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = [DateTime]::UtcNow.ToString("yyyyMMdd.HHmmssfff")
}
if ([string]::IsNullOrWhiteSpace($Version)) {
  throw "Biz script version is required."
}
if ([string]::IsNullOrWhiteSpace($PackageBaseUrl)) {
  $publicBaseUrl = [string]$env:PUBLIC_BASE_URL
  if ([string]::IsNullOrWhiteSpace($publicBaseUrl)) {
    $publicBaseUrl = "http://localhost:3012"
  }
  $PackageBaseUrl = $publicBaseUrl.TrimEnd("/") + "/downloads/agent"
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $repoRoot "account-data-platform\apps\api\dist\agent"
}
if ([string]::IsNullOrWhiteSpace($BaselineManifestPath)) {
  $BaselineManifestPath = [string]$env:BIZ_SCRIPT_BASELINE_MANIFEST
}
if ([string]::IsNullOrWhiteSpace($BaselineManifestPath)) {
  $BaselineManifestPath = Join-Path $repoRoot "dist\apk\biz-script-baseline.json"
}
$apkBaseline = Assert-BizScriptBuildBaseline -SourceRoot $sourceRoot -BaselineManifestPath $BaselineManifestPath -Version $Version

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

function Write-Utf8WithoutBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-Sha256Hex([string]$Path) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
}

function Assert-SafeBizScriptPath([string]$RelativePath) {
  if ($RelativePath -notmatch '^[\x20-\x7E]+$') {
    throw "Only printable ASCII file names are allowed in biz-scripts package entries: $RelativePath"
  }
  if ($RelativePath -notmatch '^(features|domain)/[A-Za-z0-9._/-]+\.js$' -or
    $RelativePath.Contains("..") -or $RelativePath.EndsWith("/config.js") -or
    $RelativePath.StartsWith("/")) {
    throw "Unsafe selected business script path: $RelativePath"
  }
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

function Get-BizScriptDisplayName([string]$SourcePath) {
  $firstLine = Get-Content -LiteralPath $SourcePath -Encoding UTF8 -TotalCount 1
  $nameStart = $firstLine.IndexOf([char]0xFF1A)
  $nameEnd = $firstLine.IndexOf([char]0xFF1B)
  if ($nameStart -lt 0 -or $nameEnd -le $nameStart) {
    return ""
  }
  $displayName = $firstLine.Substring($nameStart + 1, $nameEnd - $nameStart - 1).Trim()
  if ($displayName -notmatch '\.js$') {
    return ""
  }
  return $displayName
}
function Assert-ZipEntriesHaveNoUtf8Bom([string]$ArchivePath) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  $entriesWithBom = @()
  try {
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName -notmatch '(?i)\.(js|json)$') {
        continue
      }
      $stream = $entry.Open()
      try {
        [byte[]]$prefix = New-Object byte[] 3
        $read = $stream.Read($prefix, 0, $prefix.Length)
        if ($read -eq 3 -and $prefix[0] -eq 0xEF -and $prefix[1] -eq 0xBB -and $prefix[2] -eq 0xBF) {
          $entriesWithBom += $entry.FullName
        }
      } finally {
        $stream.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
  if ($entriesWithBom.Count -gt 0) {
    throw "UTF-8 BOM is not allowed in biz-scripts package entries: $($entriesWithBom -join ', ')"
  }
}

function Assert-ZipEntryNamesAreAscii([string]$ArchivePath) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  $invalidEntries = @()
  try {
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName -notmatch '^[\x20-\x7E]+$') {
        $invalidEntries += $entry.FullName
      }
    }
  } finally {
    $archive.Dispose()
  }
  if ($invalidEntries.Count -gt 0) {
    throw "Only printable ASCII file names are allowed in biz-scripts package entries: $($invalidEntries -join ', ')"
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

$selectionProvided = $PSBoundParameters.ContainsKey("Files")
if ($selectionProvided -and ($null -eq $Files -or $Files.Count -eq 0)) {
  throw "Partial business script selection cannot be empty."
}
$mode = if ($selectionProvided) { "partial" } else { "full" }
$selectedPaths = @()
if ($selectionProvided) {
  if ([string]::IsNullOrWhiteSpace($BaseVersion) -or [string]$BaseVersion -notmatch '^\d+(?:\.\d+)+$') {
    throw "Partial business scripts require a valid BaseVersion."
  }
  if ([string]::IsNullOrWhiteSpace($BaseManifestPath) -or -not (Test-Path -LiteralPath $BaseManifestPath)) {
    throw "Base manifest not found: $BaseManifestPath"
  }
  $requestedFiles = @($Files | ForEach-Object { ([string]$_).Split(',') })
  foreach ($file in $requestedFiles) {
    $normalized = ([string]$file).Replace("\", "/")
    Assert-SafeBizScriptPath $normalized
    if ($selectedPaths -contains $normalized) { throw "Duplicate selected business script path: $normalized" }
    $selectedPaths += $normalized
  }
}
$sourceFiles = $sourceFiles | Sort-Object FullName
if ($sourceFiles.Count -eq 0) {
  throw "No business scripts found."
}

function New-ManifestFile([System.IO.FileInfo]$SourceFile) {
  $relativePath = $SourceFile.FullName.Substring($sourceRoot.Length).TrimStart("\", "/").Replace("\", "/")
  Assert-SafeBizScriptPath $relativePath
  if ($relativePath -notmatch '^[\x20-\x7E]+$') {
    throw "Only printable ASCII file names are allowed in biz-scripts package entries: $relativePath"
  }
  $manifestFile = [ordered]@{
    path = $relativePath
    sha256 = Get-Sha256Hex $SourceFile.FullName
  }
  $displayName = Get-BizScriptDisplayName $SourceFile.FullName
  if (-not [string]::IsNullOrWhiteSpace($displayName)) {
    $manifestFile.displayName = $displayName
  }
  return $manifestFile
}

if ($selectionProvided) {
  $sourceFiles = @($sourceFiles | Where-Object {
    $relativePath = $_.FullName.Substring($sourceRoot.Length).TrimStart("\", "/").Replace("\", "/")
    $selectedPaths -contains $relativePath
  })
  if ($sourceFiles.Count -ne $selectedPaths.Count) {
    throw "One or more selected business scripts were not found in the source tree."
  }
}

$deltaFiles = @($sourceFiles | ForEach-Object { New-ManifestFile $_ })
$manifestFiles = $deltaFiles
if ($selectionProvided) {
  $baseManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $BaseManifestPath | ConvertFrom-Json
  Assert-BizScriptPartialBaseline -Manifest $baseManifest -ApkBaseline $apkBaseline -BaseVersion $BaseVersion
  if ($baseManifest.version -ne $BaseVersion -or $baseManifest.channel -ne "biz-scripts" -or
    $baseManifest.mode -eq "partial" -or -not $baseManifest.files) {
    throw "Base manifest must be a complete biz-scripts manifest for $BaseVersion."
  }
  $baseFiles = @($baseManifest.files | ForEach-Object {
    $path = [string]$_.path
    Assert-SafeBizScriptPath $path
    if (-not [string]$_.sha256 -or [string]$_.sha256 -notmatch '^[0-9a-f]{64}$') {
      throw "Base manifest contains an invalid SHA-256 for $path"
    }
    [ordered]@{ path = $path; sha256 = ([string]$_.sha256).ToLowerInvariant() }
  })
  $deltaMap = @{}
  foreach ($delta in $deltaFiles) { $deltaMap[$delta.path] = $delta }
  foreach ($path in $selectedPaths) {
    if (-not ($baseFiles.path -contains $path)) {
      throw "Selected business script is not present in base manifest: $path"
    }
  }
  $manifestFiles = @($baseFiles | ForEach-Object {
    if ($deltaMap.ContainsKey($_.path)) { $deltaMap[$_.path] } else { $_ }
  })
}

$embeddedManifest = [ordered]@{
  schemaVersion = 2
  version = $Version
  channel = "biz-scripts"
  baseCompatibilityId = $apkBaseline.baseCompatibilityId
  sourceSha256 = Get-BizScriptFileListHash -Files $manifestFiles
  mode = $mode
  files = $manifestFiles
  entryFile = $entryFile
}
if ($selectionProvided) {
  $embeddedManifest.baseVersion = $BaseVersion
  $embeddedManifest.deltaFiles = $deltaFiles
}
Write-Utf8WithoutBom -Path $embeddedManifestPath -Content ($embeddedManifest | ConvertTo-Json -Depth 6)

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
Assert-ZipEntriesHaveNoUtf8Bom -ArchivePath $zipPath
Assert-ZipEntryNamesAreAscii -ArchivePath $zipPath

$zipHash = Get-Sha256Hex $zipPath
$zipFileName = Split-Path -Leaf $zipPath
$encodedZipName = Convert-ToEncodedPath $zipFileName
$externalManifest = [ordered]@{
  schemaVersion = 2
  version = $Version
  channel = "biz-scripts"
  baseCompatibilityId = $embeddedManifest.baseCompatibilityId
  sourceSha256 = $embeddedManifest.sourceSha256
  mode = $mode
  files = $manifestFiles
  entryFile = $entryFile
  fileName = $zipFileName
  packageUrl = $PackageBaseUrl.TrimEnd("/") + "/" + $encodedZipName
  sha256 = $zipHash
  status = "PUBLISHED"
}
if ($selectionProvided) {
  $externalManifest.baseVersion = $BaseVersion
  $externalManifest.deltaFiles = $deltaFiles
}
Write-Utf8WithoutBom -Path $manifestPath -Content ($externalManifest | ConvertTo-Json -Depth 6)
Set-Content -LiteralPath $shaPath -Encoding ASCII -Value "$zipHash  $zipFileName"
Remove-Item -LiteralPath $embeddedManifestPath -Force

Write-Host "Biz scripts package created:"
Write-Host $zipPath
Write-Host "Manifest:"
Write-Host $manifestPath
Write-Host "SHA256:"
Write-Host $zipHash

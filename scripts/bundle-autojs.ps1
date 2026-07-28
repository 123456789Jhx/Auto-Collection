param(
  [string]$Version = "",
  [string]$PackageBaseUrl = "",
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
$sourceFiles = $sourceFiles | Sort-Object FullName
if ($sourceFiles.Count -eq 0) {
  throw "No business scripts found."
}

$manifestFiles = @($sourceFiles | ForEach-Object {
  $relativePath = $_.FullName.Substring($sourceRoot.Length).TrimStart("\", "/").Replace("\", "/")
  if ($relativePath -eq "config.js" -or -not ($relativePath.StartsWith("features/") -or $relativePath.StartsWith("domain/"))) {
    throw "Unsafe business script path: $relativePath"
  }
  if ($relativePath -notmatch '^[\x20-\x7E]+$') {
    throw "Only printable ASCII file names are allowed in biz-scripts package entries: $relativePath"
  }
  $manifestFile = [ordered]@{
    path = $relativePath
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
  }
  $displayName = Get-BizScriptDisplayName $_.FullName
  if (-not [string]::IsNullOrWhiteSpace($displayName)) {
    $manifestFile.displayName = $displayName
  }
  $manifestFile
})

$embeddedManifest = [ordered]@{
  version = $Version
  channel = "biz-scripts"
  files = $manifestFiles
  entryFile = $entryFile
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
Write-Utf8WithoutBom -Path $manifestPath -Content ($externalManifest | ConvertTo-Json -Depth 6)
Set-Content -LiteralPath $shaPath -Encoding ASCII -Value "$zipHash  $zipFileName"
Remove-Item -LiteralPath $embeddedManifestPath -Force

Write-Host "Biz scripts package created:"
Write-Host $zipPath
Write-Host "Manifest:"
Write-Host $manifestPath
Write-Host "SHA256:"
Write-Host $zipHash

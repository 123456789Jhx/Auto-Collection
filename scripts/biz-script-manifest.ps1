$bizScriptRuntimeProtocol = "autojs-biz-v2"

function Get-BizScriptTextSha256([string]$Text) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace("-", "").ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Get-BizScriptFileSha256([string]$Path) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
}

function Compare-BizScriptVersion([string]$Left, [string]$Right) {
  foreach ($value in @($Left, $Right)) {
    if ($value -notmatch '^\d+(?:\.\d+)+$') { throw "Invalid business script version: $value" }
    foreach ($part in $value.Split('.')) {
      if ([decimal]$part -gt 9007199254740991) { throw "Business script version exceeds the runtime's safe numeric range." }
    }
  }
  $leftParts = $Left.Split('.')
  $rightParts = $Right.Split('.')
  for ($i = 0; $i -lt [Math]::Max($leftParts.Length, $rightParts.Length); $i++) {
    $a = if ($i -lt $leftParts.Length) { [decimal]$leftParts[$i] } else { 0 }
    $b = if ($i -lt $rightParts.Length) { [decimal]$rightParts[$i] } else { 0 }
    if ($a -ne $b) { return [Math]::Sign($a - $b) }
  }
  return 0
}

function Get-BizScriptFileListHash([object[]]$Files, [switch]$BaseFiles) {
  if (-not $Files -or $Files.Count -eq 0) { throw "Business script manifest file list must not be empty." }
  $byPath = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
  foreach ($file in $Files) {
    $relative = [string]$file.path
    $valid = if ($BaseFiles) {
      $relative -cmatch '^(?:(?:app|core|platforms|utils)/[A-Za-z0-9._/-]+|[A-Za-z0-9._-]+)\.js$' -and $relative -cne "config.js"
    } else {
      $relative -cmatch '^(features|domain)/[A-Za-z0-9._/-]+\.js$' -and -not $relative.EndsWith("/config.js")
    }
    if (-not $valid -or $relative.Contains("..") -or $relative.Contains("//") -or $byPath.ContainsKey($relative)) {
      throw "Invalid or duplicate business manifest path: $relative"
    }
    $sha = [string]$file.sha256
    if ($sha -cnotmatch '^[0-9a-f]{64}$') { throw "Invalid manifest SHA-256 for $relative" }
    $byPath.Add($relative, $sha)
  }
  [string[]]$lines = @($byPath.Keys | ForEach-Object { $_ + ":" + $byPath[$_] })
  [Array]::Sort($lines, [StringComparer]::Ordinal)
  $text = $lines -join "`n"
  if ($BaseFiles) { $text = $bizScriptRuntimeProtocol + "`n" + $text }
  return Get-BizScriptTextSha256 $text
}

function Get-BizScriptSourceFiles([string]$SourceRoot, [switch]$BaseFiles) {
  if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { throw "Script source root not found: $SourceRoot" }
  $resolvedRoot = (Resolve-Path -LiteralPath $SourceRoot).Path.TrimEnd("\", "/")
  $roots = if ($BaseFiles) { @("app", "core", "platforms", "utils") } else { @("features", "domain") }
  $sourceFiles = @()
  foreach ($root in $roots) {
    $directory = Join-Path $resolvedRoot $root
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw "Script source directory not found: $directory" }
    $sourceFiles += @(Get-ChildItem -LiteralPath $directory -File -Recurse -Filter "*.js")
  }
  if ($BaseFiles) {
    $sourceFiles += @(Get-ChildItem -LiteralPath $resolvedRoot -File -Filter "*.js" | Where-Object { $_.Name -cne "config.js" })
  }
  $byPath = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
  foreach ($file in $sourceFiles) {
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked script files are not supported: $($file.FullName)" }
    $relative = $file.FullName.Substring($resolvedRoot.Length).TrimStart("\", "/").Replace("\", "/")
    $byPath.Add($relative, [ordered]@{ path = $relative; sha256 = Get-BizScriptFileSha256 -Path $file.FullName })
  }
  [string[]]$paths = @($byPath.Keys)
  [Array]::Sort($paths, [StringComparer]::Ordinal)
  $manifestFiles = @($paths | ForEach-Object { $byPath[$_] })
  Get-BizScriptFileListHash -Files $manifestFiles -BaseFiles:$BaseFiles | Out-Null
  return $manifestFiles
}

function Assert-BizScriptManifestContract([object]$Manifest, [switch]$RequireApkBaseline) {
  if (-not $Manifest -or $Manifest.schemaVersion -isnot [int] -or $Manifest.schemaVersion -ne 2 -or $Manifest.channel -cne "biz-scripts") {
    throw "Business script manifest must use schemaVersion 2 and channel biz-scripts."
  }
  if ($Manifest.version -isnot [string] -or $Manifest.files -isnot [Array]) { throw "Business script version and files must use string and array types." }
  Compare-BizScriptVersion $Manifest.version "0.0" | Out-Null
  $sourceHash = Get-BizScriptFileListHash -Files @($Manifest.files)
  if ($Manifest.sourceSha256 -cne $sourceHash -or [string]$Manifest.baseCompatibilityId -cnotmatch '^[0-9a-f]{64}$') {
    throw "Business script manifest fingerprint is invalid."
  }
  if ($RequireApkBaseline) {
    if ($Manifest.apkBuildId -isnot [string] -or [string]::IsNullOrWhiteSpace($Manifest.apkBuildId) -or $Manifest.baseFiles -isnot [Array]) {
      throw "APK baseline build ID and base file array are required."
    }
    $baseHash = Get-BizScriptFileListHash -Files @($Manifest.baseFiles) -BaseFiles
    if ($Manifest.baseCompatibilityId -cne $baseHash) { throw "APK baseline compatibility fingerprint is invalid." }
  }
  return $Manifest
}

function Read-BizScriptBaselineManifest([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "A confirmed APK baseline manifest is required: $Path"
  }
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
  return Assert-BizScriptManifestContract -Manifest $manifest -RequireApkBaseline
}

function Assert-BizScriptBuildBaseline([string]$SourceRoot, [string]$BaselineManifestPath, [string]$Version) {
  $baseline = Read-BizScriptBaselineManifest -Path $BaselineManifestPath
  if ((Compare-BizScriptVersion $Version ([string]$baseline.version)) -le 0) {
    throw "Business script version must be newer than APK baseline $($baseline.version)."
  }
  $baseFiles = @(Get-BizScriptSourceFiles -SourceRoot $SourceRoot -BaseFiles)
  if ((Get-BizScriptFileListHash -Files $baseFiles -BaseFiles) -cne $baseline.baseCompatibilityId) {
    throw "Current base scripts do not match the confirmed APK baseline; rebuild the APK before publishing."
  }
  return $baseline
}

function Assert-BizScriptPartialBaseline([object]$Manifest, [object]$ApkBaseline, [string]$BaseVersion) {
  Assert-BizScriptManifestContract -Manifest $Manifest | Out-Null
  if ($Manifest.version -cne $BaseVersion -or $Manifest.mode -eq "partial" -or
    $Manifest.baseCompatibilityId -cne $ApkBaseline.baseCompatibilityId -or
    (Compare-BizScriptVersion $BaseVersion ([string]$ApkBaseline.version)) -le 0) {
    throw "Partial business scripts require a complete compatible base newer than the APK baseline."
  }
}

function Write-BizScriptBaselineManifest([string]$SourceRoot, [string]$OutputPath, [string]$Version = "", [string]$ApkBuildId) {
  if ([string]::IsNullOrWhiteSpace($OutputPath)) { throw "An explicit baseline output path is required." }
  if ([string]::IsNullOrWhiteSpace($ApkBuildId)) { throw "APK build ID is required." }
  if ([string]::IsNullOrWhiteSpace($Version)) { $Version = [DateTime]::UtcNow.ToString("yyyyMMdd.HHmmssfff") }
  $files = @(Get-BizScriptSourceFiles -SourceRoot $SourceRoot)
  $baseFiles = @(Get-BizScriptSourceFiles -SourceRoot $SourceRoot -BaseFiles)
  $manifest = [ordered]@{
    schemaVersion = 2
    channel = "biz-scripts"
    version = $Version
    apkBuildId = $ApkBuildId
    files = $files
    baseFiles = $baseFiles
    sourceSha256 = Get-BizScriptFileListHash -Files $files
    baseCompatibilityId = Get-BizScriptFileListHash -Files $baseFiles -BaseFiles
  }
  Assert-BizScriptManifestContract -Manifest $manifest -RequireApkBaseline | Out-Null
  $directory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  [IO.File]::WriteAllText($OutputPath, ($manifest | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
}

function Write-BizScriptAtomicText([string]$Path, [string]$Text) {
  $destination = [IO.Path]::GetFullPath($Path)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  $temporary = $destination + "." + [Guid]::NewGuid().ToString("N") + ".tmp"
  try {
    [IO.File]::WriteAllText($temporary, $Text, (New-Object Text.UTF8Encoding($false)))
    if ([IO.File]::Exists($destination)) { [IO.File]::Replace($temporary, $destination, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $destination) }
  } finally {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
  }
}

function Export-BizScriptApkBaseline([string]$ApkPath, [string]$ExpectedBaselineText, [string]$DefaultManifestPath) {
  if ([string]::IsNullOrWhiteSpace($DefaultManifestPath) -or [IO.Path]::GetExtension($DefaultManifestPath) -ine ".json") {
    throw "The default APK baseline output must be an explicit JSON file."
  }
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($ApkPath)
  try {
    $entry = $archive.GetEntry("assets/project/biz-script-baseline.json")
    if (-not $entry) { throw "Final APK does not contain its business baseline manifest." }
    $reader = New-Object IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
    try { $embeddedText = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($embeddedText -cne $ExpectedBaselineText) { throw "Final APK business baseline differs from the confirmed staged input." }
    $baseline = Assert-BizScriptManifestContract -Manifest ($embeddedText | ConvertFrom-Json) -RequireApkBaseline
    foreach ($file in @($baseline.files) + @($baseline.baseFiles)) {
      $scriptEntry = $archive.GetEntry("assets/project/" + [string]$file.path)
      if (-not $scriptEntry) { throw "Final APK is missing declared script: $($file.path)" }
      $stream = $scriptEntry.Open()
      $algorithm = [Security.Cryptography.SHA256]::Create()
      try { $actual = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
      finally { $stream.Dispose(); $algorithm.Dispose() }
      if ($actual -cne [string]$file.sha256) { throw "Final APK script SHA-256 mismatch: $($file.path)" }
    }
  } finally {
    $archive.Dispose()
  }
  Write-BizScriptAtomicText -Path ($ApkPath + ".biz-script-baseline.json") -Text $embeddedText
  Write-BizScriptAtomicText -Path $DefaultManifestPath -Text $embeddedText
}

param(
  [string]$PackageBaseUrl = "https://qk-api.dafengchan.top/downloads/agent",
  [string]$ApiBaseUrl = "http://127.0.0.1:3012/api/v1",
  [string]$BaseVersion = "1.3.7",
  [string]$AdminUsername = "root",
  [string]$AdminPassword = "root",
  [int]$DebounceMilliseconds = 1500,
  [switch]$PublishInitial
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$bundleScript = Join-Path $repoRoot "scripts\bundle-autojs.ps1"
$publishScript = Join-Path $repoRoot "scripts\publish-autojs-version.ps1"
$outputDir = Join-Path $repoRoot "account-data-platform\apps\api\dist\agent"
$sourceRoots = @(
  (Join-Path $repoRoot "mobile-agent\autojs\features"),
  (Join-Path $repoRoot "mobile-agent\autojs\domain")
)

function New-DevelopmentVersion {
  return $BaseVersion + "." + (Get-Date -Format "yyyyMMddHHmmss")
}

function Publish-BizScripts {
  $version = New-DevelopmentVersion
  Write-Host "Publishing biz-scripts development version: $version"
  & $bundleScript -Version $version -PackageBaseUrl $PackageBaseUrl -OutputDir $outputDir
  $manifestPath = Join-Path $outputDir ("AgriVideoCollector-biz-scripts-" + $version + ".json")
  & $publishScript -ManifestPath $manifestPath -ApiBaseUrl $ApiBaseUrl -AdminUsername $AdminUsername -AdminPassword $AdminPassword -ReleaseNote "Local business script hot reload"
  Write-Host "Published $version. Idle devices apply it on their next hot-reload poll."
}

$watchers = @()
$sourceRoots | ForEach-Object {
  if (-not (Test-Path -LiteralPath $_)) { throw "Business script source directory not found: $_" }
  $watcher = New-Object System.IO.FileSystemWatcher $_, "*.js"
  $watcher.IncludeSubdirectories = $true
  $watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::LastWrite
  $watcher.EnableRaisingEvents = $true
  $watchers += $watcher
  foreach ($eventName in @("Changed", "Created", "Deleted", "Renamed")) {
    Register-ObjectEvent -InputObject $watcher -EventName $eventName -SourceIdentifier ("biz-watch-" + $watchers.Count + "-" + $eventName) | Out-Null
  }
}

if ($PublishInitial) { Publish-BizScripts }
Write-Host "Watching features/ and domain/ for .js changes. Press Ctrl+C to stop."
$lastChangeAt = $null
try {
  while ($true) {
    $event = Wait-Event -Timeout 1
    if ($event) {
      $changedPath = [string]$event.SourceEventArgs.FullPath
      Remove-Event -EventIdentifier $event.EventIdentifier -ErrorAction SilentlyContinue
      if ([IO.Path]::GetExtension($changedPath) -eq ".js") {
        $lastChangeAt = Get-Date
        Write-Host "Detected business script change: $changedPath"
      }
    }
    if ($lastChangeAt -and (((Get-Date) - $lastChangeAt).TotalMilliseconds -ge $DebounceMilliseconds)) {
      $lastChangeAt = $null
      Publish-BizScripts
      Start-Sleep -Seconds 1
    }
  }
} finally {
  $watchers | ForEach-Object { $_.Dispose() }
  Get-EventSubscriber | Where-Object { $_.SourceIdentifier -like "biz-watch-*" } | Unregister-Event
}

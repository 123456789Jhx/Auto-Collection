param(
  [string]$ApkPath = "",
  [string]$PackageName = "com.agri.video.collector",
  [string]$AdbPath = "",
  [switch]$SkipUninstall,
  [switch]$PrepareMiuiDeveloperInstall,
  [bool]$LaunchInstallerOnRestricted = $true
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Resolve-AdbPath([string]$PreferredPath) {
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($PreferredPath)) {
    $candidates += $PreferredPath
  }
  if ($env:ANDROID_HOME) {
    $candidates += (Join-Path $env:ANDROID_HOME "platform-tools\adb.exe")
  }
  if ($env:ANDROID_SDK_ROOT) {
    $candidates += (Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe")
  }
  $candidates += "D:\DevTools\Android\Sdk\platform-tools\adb.exe"
  $command = Get-Command "adb.exe" -ErrorAction SilentlyContinue
  if ($command) {
    $candidates += $command.Source
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return (Resolve-Path $candidate).Path
    }
  }
  throw "adb.exe was not found. Pass -AdbPath or set ANDROID_HOME."
}

function Resolve-ApkPath([string]$PreferredPath) {
  if (-not [string]::IsNullOrWhiteSpace($PreferredPath)) {
    if (-not (Test-Path $PreferredPath)) {
      throw "APK was not found: $PreferredPath"
    }
    return (Resolve-Path $PreferredPath).Path
  }

  $apkDir = Join-Path $repoRoot "dist\apk"
  $apk = Get-ChildItem -LiteralPath $apkDir -Filter "*-inrt.apk" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $apk) {
    throw "No *-inrt.apk was found under $apkDir"
  }
  return $apk.FullName
}

$script:ResolvedAdbPath = Resolve-AdbPath $AdbPath
$resolvedApkPath = Resolve-ApkPath $ApkPath

function Invoke-Adb([string[]]$Arguments, [switch]$IgnoreError) {
  Write-Host "adb $($Arguments -join ' ')"
  $previousErrorActionPreference = $ErrorActionPreference
  $nativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
  $hasNativePreference = $null -ne $nativePreference
  $previousNativePreference = if ($hasNativePreference) { [bool]$nativePreference.Value } else { $false }
  try {
    $ErrorActionPreference = "Continue"
    if ($hasNativePreference) {
      $PSNativeCommandUseErrorActionPreference = $false
    }
    $output = & $script:ResolvedAdbPath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    if ($hasNativePreference) {
      $PSNativeCommandUseErrorActionPreference = $previousNativePreference
    }
  }
  $outputLines = @($output) | ForEach-Object { $_.ToString() }
  if ($output) {
    $outputLines | ForEach-Object { Write-Host $_ }
  }
  if ($exitCode -ne 0 -and -not $IgnoreError) {
    throw "adb $($Arguments -join ' ') failed with exit code $exitCode"
  }
  [pscustomobject]@{
    ExitCode = $exitCode
    Output = ($outputLines -join "`n")
  }
}

Write-Host "Using adb: $script:ResolvedAdbPath"
Write-Host "Using APK: $resolvedApkPath"
Write-Host "Running adb devices"
$devicesResult = Invoke-Adb -Arguments @("devices")
$devices = @()
foreach ($line in ($devicesResult.Output -split "`n")) {
  $trimmed = $line.Trim()
  if ($trimmed -match "^([^\s]+)\s+device$") {
    $devices += $Matches[1]
  }
}

if ($devices.Count -eq 0) {
  throw "No authorized USB devices were found by adb devices."
}

function Invoke-MiuiPreparation([string]$Serial) {
  if (-not $PrepareMiuiDeveloperInstall) {
    return
  }

  $commands = @(
    @("-s", $Serial, "shell", "settings", "put", "global", "verifier_verify_adb_installs", "0"),
    @("-s", $Serial, "shell", "settings", "put", "global", "package_verifier_enable", "0"),
    @("-s", $Serial, "shell", "settings", "put", "secure", "install_non_market_apps", "1"),
    @("-s", $Serial, "shell", "appops", "set", "com.android.shell", "REQUEST_INSTALL_PACKAGES", "allow"),
    @("-s", $Serial, "shell", "appops", "set", "com.miui.packageinstaller", "REQUEST_INSTALL_PACKAGES", "allow")
  )

  foreach ($command in $commands) {
    Invoke-Adb -Arguments $command -IgnoreError | Out-Null
  }
}

function Invoke-VersionCheck([string]$Serial) {
  $result = Invoke-Adb -Arguments @("-s", $Serial, "shell", "dumpsys", "package", $PackageName) -IgnoreError
  if ($result.Output -match "versionName=([^\s]+)") {
    Write-Host "Installed $PackageName versionName=$($Matches[1]) on $Serial"
  } else {
    Write-Warning "Package $PackageName was not verified on $Serial. Check the phone installer result."
  }
}

foreach ($serial in $devices) {
  Write-Host "Installing on device: $serial"
  Invoke-MiuiPreparation $serial

  if (-not $SkipUninstall) {
    Write-Host "Running adb uninstall"
    Invoke-Adb -Arguments @("-s", $serial, "uninstall", $PackageName) -IgnoreError | Out-Null
  }

  Write-Host "Running adb install"
  $installResult = Invoke-Adb -Arguments @("-s", $serial, "install", "-r", "-g", $resolvedApkPath) -IgnoreError
  if ($installResult.ExitCode -eq 0) {
    Invoke-VersionCheck $serial
    continue
  }

  if ($installResult.Output -match "INSTALL_FAILED_USER_RESTRICTED") {
    Write-Warning "ADB install was blocked by user restriction on $serial."
    if (-not $LaunchInstallerOnRestricted) {
      continue
    }

    $apkFileName = [System.IO.Path]::GetFileName($resolvedApkPath)
    $remoteApkPath = "/sdcard/Download/$apkFileName"
    Invoke-Adb -Arguments @("-s", $serial, "push", $resolvedApkPath, $remoteApkPath)
    Write-Host "Running adb shell am start"
    Invoke-Adb -Arguments @(
      "-s",
      $serial,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      "file://$remoteApkPath",
      "-t",
      "application/vnd.android.package-archive"
    ) -IgnoreError | Out-Null
    Write-Warning "APK was pushed to $remoteApkPath and the system installer was launched. Confirm the install on the phone, then rerun version check if needed."
    continue
  }

  throw "ADB install failed on ${serial}: $($installResult.Output)"
}

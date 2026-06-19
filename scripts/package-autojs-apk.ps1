param(
  [string]$AutoJs6Root = "D:\DevTools\Sources\AutoJs6",
  [string]$JavaHome = "D:\Javasource\javaTools\jdk-21.0.10",
  [string]$AndroidSdkRoot = "D:\DevTools\Android\Sdk",
  [string]$KeystorePath = "D:\DevTools\Android\Keystores\agri-video-collector-dev.jks",
  [string]$OutputDir = "dist\apk",
  [string[]]$NativeAbis = @("arm64-v8a"),
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$projectSource = Join-Path $repoRoot "mobile-agent\autojs"
$targetProject = Join-Path $AutoJs6Root "app\src\main\assets-inrt\project"
$outputPath = Join-Path $repoRoot $OutputDir

if (-not (Test-Path $AutoJs6Root)) {
  throw "AutoJs6 source root not found: $AutoJs6Root"
}
if (-not (Test-Path $projectSource)) {
  throw "AutoJS project source not found: $projectSource"
}

$projectConfigPath = Join-Path $projectSource "project.json"
$sourceConfig = Get-Content -Raw -Encoding UTF8 -Path $projectConfigPath | ConvertFrom-Json
$sourceIconPath = Join-Path $projectSource "assets\app-icon.png"
$gradleBuildPath = Join-Path $AutoJs6Root "app\build.gradle.kts"
$inrtManifestPath = Join-Path $AutoJs6Root "app\src\inrt\AndroidManifest.xml"
$assetsProjectLauncherPath = Join-Path $AutoJs6Root "app\src\main\java\org\autojs\autojs\inrt\launch\AssetsProjectLauncher.kt"
$rootUtilsPath = Join-Path $AutoJs6Root "app\src\main\java\org\autojs\autojs\util\RootUtils.java"
$abstractAutoJsPath = Join-Path $AutoJs6Root "app\src\main\java\org\autojs\autojs\AbstractAutoJs.kt"
$processShellPath = Join-Path $AutoJs6Root "app\src\main\java\org\autojs\autojs\runtime\api\ProcessShell.java"
$abstractShellPath = Join-Path $AutoJs6Root "app\src\main\java\org\autojs\autojs\runtime\api\AbstractShell.java"
$appName = if ($sourceConfig.name) { [string]$sourceConfig.name } else { "AgriVideoCollector" }
$packageName = if ($sourceConfig.packageName) { [string]$sourceConfig.packageName } else { "com.agri.video.collector" }
$versionName = [string]$sourceConfig.versionName
$versionCode = [int]$sourceConfig.versionCode

function Assert-LastCommandSucceeded([string]$message) {
  if ($LASTEXITCODE -ne 0) {
    throw "$message failed with exit code $LASTEXITCODE"
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Value) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Add-NativeLibrariesToApk([string]$ApkPath, [string]$NativeLibRoot, [string[]]$Abis) {
  if (-not (Test-Path $NativeLibRoot)) {
    Write-Host "Native lib root not found, skip injection: $NativeLibRoot"
    return
  }

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $apkArchive = [System.IO.Compression.ZipFile]::Open($ApkPath, [System.IO.Compression.ZipArchiveMode]::Update)
  try {
    $nativeFiles = foreach ($abi in $Abis) {
      $abiRoot = Join-Path $NativeLibRoot $abi
      if (Test-Path $abiRoot) {
        Get-ChildItem -LiteralPath $abiRoot -Recurse -Filter "*.so" -File
      } else {
        Write-Host "Native ABI not found, skip: $abiRoot"
      }
    }
    foreach ($nativeFile in $nativeFiles) {
      $relativePath = $nativeFile.FullName.Substring($NativeLibRoot.Length).TrimStart("\", "/")
      $entryName = ("lib\" + $relativePath).Replace("\", "/")
      $existingEntry = $apkArchive.GetEntry($entryName)
      if ($existingEntry) {
        $existingEntry.Delete()
      }
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $apkArchive,
        $nativeFile.FullName,
        $entryName,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
    Write-Host "Native libraries injected:"
    Write-Host "  Source: $NativeLibRoot"
    Write-Host "  ABIs: $($Abis -join ', ')"
    Write-Host "  Count: $($nativeFiles.Count)"
  } finally {
    $apkArchive.Dispose()
  }
}

function Write-InrtPermissionOverlay([string]$ManifestPath) {
  $manifestDir = Split-Path $ManifestPath
  New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null

  $removePermissions = @(
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.MANAGE_EXTERNAL_STORAGE",
    "android.permission.BROADCAST_CLOSE_SYSTEM_DIALOGS",
    "android.permission.READ_PRIVILEGED_PHONE_STATE",
    "com.android.launcher.permission.INSTALL_SHORTCUT",
    "com.android.launcher.permission.UNINSTALL_SHORTCUT",
    "android.permission.REQUEST_INSTALL_PACKAGES",
    "android.permission.REQUEST_DELETE_PACKAGES",
    "android.permission.USE_EXACT_ALARM",
    "android.permission.SCHEDULE_EXACT_ALARM",
    "android.permission.VIBRATE",
    "android.permission.ACCESS_WIFI_STATE",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.CHANGE_WIFI_STATE",
    "android.permission.CHANGE_NETWORK_STATE",
    "android.permission.CHANGE_WIFI_MULTICAST_STATE",
    "android.permission.REORDER_TASKS",
    "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.UNLIMITED_TOASTS",
    "android.permission.CAPTURE_VIDEO_OUTPUT",
    "android.permission.DUMP",
    "android.permission.QUERY_ALL_PACKAGES",
    "android.permission.PACKAGE_USAGE_STATS",
    "android.permission.WRITE_SETTINGS",
    "android.permission.WRITE_SECURE_SETTINGS",
    "android.permission.MANAGE_USERS",
    "android.permission.INTERACT_ACROSS_USERS_FULL",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_LOCATION_EXTRA_COMMANDS",
    "android.permission.RECORD_AUDIO",
    "com.termux.permission.RUN_COMMAND",
    "android.permission.READ_CONTACTS",
    "android.permission.WRITE_CONTACTS",
    "android.permission.READ_PHONE_STATE",
    "android.permission.CALL_PHONE",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.READ_SMS",
    "android.permission.SEND_SMS",
    "android.permission.RECEIVE_SMS",
    "android.permission.CAMERA",
    "android.permission.FLASHLIGHT",
    "android.permission.EXPAND_STATUS_BAR",
    "android.permission.GET_ACCOUNTS",
    "android.permission.READ_CALENDAR",
    "android.permission.WRITE_CALENDAR",
    "android.permission.DISABLE_KEYGUARD",
    "android.permission.BLUETOOTH",
    "android.permission.BLUETOOTH_ADMIN",
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.BLUETOOTH_SCAN",
    "android.permission.BLUETOOTH_ADVERTISE",
    "android.permission.SET_WALLPAPER",
    "android.permission.SET_WALLPAPER_HINTS",
    "android.permission.MOUNT_UNMOUNT_FILESYSTEMS",
    "android.permission.MOUNT_FORMAT_FILESYSTEMS",
    "android.permission.KILL_BACKGROUND_PROCESSES",
    "android.permission.NFC",
    "moe.shizuku.manager.permission.API_V23",
    "com.android.vending.BILLING"
  )

  $permissionLines = $removePermissions | ForEach-Object {
    "    <uses-permission android:name=""$_"" tools:node=""remove"" />"
  }
  $removeComponents = @(
    "androidx.work.impl.background.systemalarm.RescheduleReceiver",
    "androidx.work.impl.background.systemjob.SystemJobService",
    "androidx.work.impl.diagnostics.DiagnosticsReceiver",
    "com.evernote.android.job.JobBootReceiver",
    "com.evernote.android.job.v14.PlatformAlarmReceiver",
    "com.evernote.android.job.v21.PlatformJobService",
    "org.autojs.autojs.timing.BootCompletedReceiver",
    "org.autojs.autojs.inrt.InrtBootCompletedReceiver",
    "org.autojs.autojs.external.receiver.StaticBroadcastReceiver",
    "org.autojs.autojs.external.tasker.FireSettingReceiver",
    "org.autojs.autojs.external.widget.ScriptWidget",
    "org.autojs.autojs.timing.TaskReceiver",
    "org.autojs.autojs.timing.TimedTaskAlarmReceiver"
  )
  $componentLines = $removeComponents | ForEach-Object {
    $tag = if ($_ -like "*Service") { "service" } else { "receiver" }
    "        <$tag android:name=""$_"" tools:node=""remove"" />"
  }
  $manifest = @"
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
$($permissionLines -join "`r`n")
    <application>
$($componentLines -join "`r`n")
    </application>
</manifest>
"@
  Write-Utf8NoBom -Path $ManifestPath -Value $manifest
  Write-Host "Inrt permission overlay written:"
  Write-Host "  $ManifestPath"
}

function Write-LauncherIconResources([string]$SourceIconPath, [string]$ResRoot) {
  if (-not (Test-Path $SourceIconPath)) {
    Write-Host "Launcher icon source not found, skip icon patch: $SourceIconPath"
    return
  }

  Add-Type -AssemblyName System.Drawing

  $densitySizes = [ordered]@{
    "mipmap-mdpi" = 48
    "mipmap-hdpi" = 72
    "mipmap-xhdpi" = 96
    "mipmap-xxhdpi" = 144
    "mipmap-xxxhdpi" = 192
    "mipmap" = 512
  }

  $sourceImage = [System.Drawing.Image]::FromFile($SourceIconPath)
  try {
    foreach ($entry in $densitySizes.GetEnumerator()) {
      $targetDir = Join-Path $ResRoot $entry.Key
      New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
      $targetPath = Join-Path $targetDir "ic_launcher.png"
      $size = [int]$entry.Value
      $bitmap = New-Object System.Drawing.Bitmap $size, $size
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
          $graphics.Clear([System.Drawing.Color]::Transparent)
          $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
          $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
        } finally {
          $graphics.Dispose()
        }
        $bitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $bitmap.Dispose()
      }
    }
    Write-Host "Launcher icons written from:"
    Write-Host "  $SourceIconPath"
  } finally {
    $sourceImage.Dispose()
  }
}

function Patch-InrtUiLaunchFlags([string]$LauncherPath) {
  if (-not (Test-Path $LauncherPath)) {
    Write-Host "AssetsProjectLauncher not found, skip UI launch patch: $LauncherPath"
    return
  }
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $LauncherPath
  $old = 'config.intentFlags = Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_TASK_ON_HOME'
  $new = 'config.intentFlags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP'
  if ($text.Contains($old)) {
    $text = $text.Replace($old, $new)
    Write-Utf8NoBom -Path $LauncherPath -Value $text
    Write-Host "Patched inrt UI launch flags:"
    Write-Host "  $LauncherPath"
  } elseif ($text.Contains($new)) {
    Write-Host "Inrt UI launch flags already patched:"
    Write-Host "  $LauncherPath"
  } else {
    Write-Host "Inrt UI launch flag pattern not found, review manually:"
    Write-Host "  $LauncherPath"
  }
}

function Patch-InrtPreserveUpdatedProject([string]$LauncherPath) {
  if (-not (Test-Path $LauncherPath)) {
    Write-Host "AssetsProjectLauncher not found, skip project preservation patch: $LauncherPath"
    return
  }

  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $LauncherPath
  $old = @"
        val projectConfig = ProjectConfig.fromProjectDir(mProjectDir)
        if (projectConfig != null &&
            TextUtils.equals(projectConfig.buildInfo.buildId, mProjectConfig.buildInfo.buildId)
        ) {
            initKey(projectConfig)
            return
        }
"@
  $new = @"
        val projectConfig = ProjectConfig.fromProjectDir(mProjectDir)
        if (projectConfig != null && File(mProjectDir, projectConfig.mainScriptFileName).isFile) {
            initKey(projectConfig)
            return
        }
"@

  if ($text.Contains($old)) {
    $text = $text.Replace($old, $new)
    Write-Utf8NoBom -Path $LauncherPath -Value $text
    Write-Host "Patched inrt project preservation:"
    Write-Host "  $LauncherPath"
  } elseif ($text.Contains('if (projectConfig != null && File(mProjectDir, projectConfig.mainScriptFileName).isFile)')) {
    Write-Host "Inrt project preservation already patched:"
    Write-Host "  $LauncherPath"
  } else {
    Write-Host "Inrt project preservation pattern not found, review manually:"
    Write-Host "  $LauncherPath"
  }
}

function Patch-InrtNoRootRuntime(
  [string]$RootUtilsPath,
  [string]$AbstractAutoJsPath,
  [string]$ProcessShellPath,
  [string]$AbstractShellPath
) {
  if (Test-Path $RootUtilsPath) {
    $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $RootUtilsPath
    if (-not $text.Contains("import org.autojs.autojs6.BuildConfig;")) {
      $text = $text.Replace("import org.autojs.autojs6.R;", "import org.autojs.autojs6.R;`r`nimport org.autojs.autojs6.BuildConfig;")
    }
    $old = @"
    public static boolean isRootAvailable() {
        RootMode rootMode = getRootMode();
        return rootMode == RootMode.AUTO_DETECT
                ? isSuPresentFast() || getRootStateWithRootShell()
                : rootMode == RootMode.FORCE_ROOT;
    }
"@
    $new = @"
    public static boolean isRootAvailable() {
        if (BuildConfig.isInrt) {
            return false;
        }
        RootMode rootMode = getRootMode();
        return rootMode == RootMode.AUTO_DETECT
                ? isSuPresentFast() || getRootStateWithRootShell()
                : rootMode == RootMode.FORCE_ROOT;
    }
"@
    if ($text.Contains($old)) {
      $text = $text.Replace($old, $new)
      Write-Utf8NoBom -Path $RootUtilsPath -Value $text
      Write-Host "Patched inrt root availability:"
      Write-Host "  $RootUtilsPath"
  } elseif ($text.Contains("if (BuildConfig.isInrt) {`r`n            return false;")) {
      Write-Host "Inrt root availability already patched:"
      Write-Host "  $RootUtilsPath"
    } elseif ($text.Contains("if (BuildConfig.isInrt)") -and $text.Contains("return false;")) {
      Write-Host "Inrt root availability already patched:"
      Write-Host "  $RootUtilsPath"
    } else {
      Write-Host "RootUtils patch pattern not found, review manually:"
      Write-Host "  $RootUtilsPath"
    }
  }

  if (Test-Path $AbstractAutoJsPath) {
    $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $AbstractAutoJsPath
    $old = ".setShellSupplier { Shell(applicationContext, true) }"
    $new = ".setShellSupplier { Shell(applicationContext, false) }"
    if ($text.Contains($old)) {
      $text = $text.Replace($old, $new)
      Write-Utf8NoBom -Path $AbstractAutoJsPath -Value $text
      Write-Host "Patched default runtime shell to non-root:"
      Write-Host "  $AbstractAutoJsPath"
    } elseif ($text.Contains($new)) {
      Write-Host "Default runtime shell already non-root:"
      Write-Host "  $AbstractAutoJsPath"
    } else {
      Write-Host "Default shell patch pattern not found, review manually:"
      Write-Host "  $AbstractAutoJsPath"
    }
  }

  if (Test-Path $ProcessShellPath) {
    $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $ProcessShellPath
    $old = "Process process = withRoot ? getRootProcess() : getShellProcess();"
    $new = "Process process = (withRoot && !org.autojs.autojs6.BuildConfig.isInrt) ? getRootProcess() : getShellProcess();"
    if ($text.Contains($old)) {
      $text = $text.Replace($old, $new)
      Write-Utf8NoBom -Path $ProcessShellPath -Value $text
      Write-Host "Patched ProcessShell root execution guard:"
      Write-Host "  $ProcessShellPath"
    } elseif ($text.Contains($new)) {
      Write-Host "ProcessShell root execution guard already patched:"
      Write-Host "  $ProcessShellPath"
    } else {
      Write-Host "ProcessShell patch pattern not found, review manually:"
      Write-Host "  $ProcessShellPath"
    }
  }

  if (Test-Path $AbstractShellPath) {
    $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $AbstractShellPath
    $old = "init(isExecWithRoot ? COMMAND_SU : COMMAND_SH);"
    $new = "init(isExecWithRoot && !org.autojs.autojs6.BuildConfig.isInrt ? COMMAND_SU : COMMAND_SH);"
    if ($text.Contains($old)) {
      $text = $text.Replace($old, $new)
      Write-Utf8NoBom -Path $AbstractShellPath -Value $text
      Write-Host "Patched AbstractShell root command guard:"
      Write-Host "  $AbstractShellPath"
    } elseif ($text.Contains($new)) {
      Write-Host "AbstractShell root command guard already patched:"
      Write-Host "  $AbstractShellPath"
    } else {
      Write-Host "AbstractShell patch pattern not found, review manually:"
      Write-Host "  $AbstractShellPath"
    }
  }
}

if (-not (Test-Path $gradleBuildPath)) {
  throw "AutoJs6 app build script not found: $gradleBuildPath"
}

Write-InrtPermissionOverlay -ManifestPath $inrtManifestPath
Write-LauncherIconResources -SourceIconPath $sourceIconPath -ResRoot (Join-Path $AutoJs6Root "app\src\main\res")
Patch-InrtUiLaunchFlags -LauncherPath $assetsProjectLauncherPath
Patch-InrtPreserveUpdatedProject -LauncherPath $assetsProjectLauncherPath
Patch-InrtNoRootRuntime -RootUtilsPath $rootUtilsPath -AbstractAutoJsPath $abstractAutoJsPath -ProcessShellPath $processShellPath -AbstractShellPath $abstractShellPath

$gradleText = Get-Content -Raw -Encoding UTF8 -Path $gradleBuildPath
$inrtPattern = '(?s)(create\(flavorNameInrt\)\s*\{)(.*?)(\n\s{8}\})'
$inrtMatch = [regex]::Match($gradleText, $inrtPattern)
if (-not $inrtMatch.Success) {
  throw "AutoJs6 inrt product flavor block was not found"
}
$inrtBlock = $inrtMatch.Groups[2].Value
$inrtBlock = [regex]::Replace($inrtBlock, '(?m)^\s*\$\d+\s*\r?\n', '')
$inrtBlock = [regex]::Replace($inrtBlock, '(applicationId\s*=\s*)".*?"', '${1}"' + $packageName + '"')
if ($inrtBlock -match '(versionCode\s*=\s*)\d+') {
  $inrtBlock = [regex]::Replace($inrtBlock, '(versionCode\s*=\s*)\d+', '${1}' + $versionCode)
} elseif ($inrtBlock -match '^\s*\$\d+\s*$') {
  $inrtBlock = [regex]::Replace($inrtBlock, '(?m)^\s*\$\d+\s*$', '            versionCode = ' + $versionCode)
} else {
  $inrtBlock = [regex]::Replace($inrtBlock, '(targetSdk\s*=\s*versions\.sdkVersionTargetInrt\s*\r?\n)', '${1}            versionCode = ' + $versionCode + "`r`n")
}
$inrtBlock = [regex]::Replace($inrtBlock, '(versionName\s*=\s*)".*?"', '${1}"' + $versionName + '"')
$inrtBlock = [regex]::Replace($inrtBlock, '("appName"\s+to\s+)".*?"', '${1}"' + $appName + '"')
$inrtBlock = [regex]::Replace($inrtBlock, '("authorities"\s+to\s+)".*?\.fileprovider"', '${1}"' + $packageName + '.fileprovider"')
$gradleText =
  $gradleText.Substring(0, $inrtMatch.Groups[2].Index) +
  $inrtBlock +
  $gradleText.Substring($inrtMatch.Groups[2].Index + $inrtMatch.Groups[2].Length)

$gradleText = [regex]::Replace(
  $gradleText,
  '(?m)^(\s*)excludes \+= "\*"\s*$',
  '${1}// Native libraries are required by the embedded AutoJs6 runtime.'
)
Set-Content -Path $gradleBuildPath -Value $gradleText -Encoding UTF8

New-Item -ItemType Directory -Force -Path $targetProject | Out-Null

Get-ChildItem -LiteralPath $targetProject -Force | Remove-Item -Recurse -Force

$excludedDirs = @("datasource", "build", ".git", ".idea", "node_modules")
Get-ChildItem -LiteralPath $projectSource -Force | ForEach-Object {
  if ($excludedDirs -contains $_.Name) {
    return
  }
  Copy-Item -LiteralPath $_.FullName -Destination $targetProject -Recurse -Force
}

$registrationSecret = [string]$env:MOBILE_REGISTRATION_SECRET
if (-not [string]::IsNullOrWhiteSpace($registrationSecret)) {
  $targetConfigPath = Join-Path $targetProject "config.js"
  if (Test-Path $targetConfigPath) {
    $targetConfigText = Get-Content -Raw -Encoding UTF8 -LiteralPath $targetConfigPath
    $targetConfigText = [regex]::Replace(
      $targetConfigText,
      '(registrationSecret\s*:\s*)".*?"',
      '${1}"' + $registrationSecret + '"',
      1
    )
    Write-Utf8NoBom -Path $targetConfigPath -Value $targetConfigText
    Write-Host "Registration secret injected into staged AutoJS config."
  }
}

$buildId = "AGRI-" + (Get-Date -Format "yyyyMMddHHmmss")
$inrtConfig = [ordered]@{
  name = $appName
  main = $sourceConfig.main
  versionName = $versionName
  versionCode = $versionCode
  packageName = $packageName
  description = $sourceConfig.description
  assets = @()
  build = [ordered]@{
    build_id = $buildId
    build_number = [int]$sourceConfig.versionCode
    build_time = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  }
  launchConfig = [ordered]@{
    logsVisible = $false
    splashVisible = $false
    launcherVisible = $true
    runOnBoot = $false
    slug = $appName
  }
  permissions = @(
    "android.permission.WAKE_LOCK",
    "android.permission.INTERNET",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
    "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
    "android.permission.SYSTEM_ALERT_WINDOW"
  )
}

Write-Utf8NoBom -Path (Join-Path $targetProject "project.json") -Value ($inrtConfig | ConvertTo-Json -Depth 8)

Write-Host "Synced AutoJS project:"
Write-Host "  Source: $projectSource"
Write-Host "  Target: $targetProject"
Write-Host "  BuildId: $buildId"

if ($SkipBuild) {
  exit 0
}

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidSdkRoot
$env:ANDROID_SDK_ROOT = $AndroidSdkRoot
$env:Path = "$JavaHome\bin;$AndroidSdkRoot\platform-tools;$AndroidSdkRoot\cmdline-tools\latest\bin;$AndroidSdkRoot\build-tools\36.0.0;$env:Path"

Push-Location $AutoJs6Root
try {
  .\gradlew.bat app:assembleInrtRelease --no-daemon --stacktrace
  Assert-LastCommandSucceeded "Gradle build"
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$apkCandidates = Get-ChildItem -Path (Join-Path $AutoJs6Root "app\build\outputs\apk\inrt\release") -Filter "*.apk" -File -ErrorAction SilentlyContinue
if (-not $apkCandidates) {
  throw "APK was not found under app\build\outputs\apk\inrt\release"
}

$apk = $apkCandidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$unsignedDest = Join-Path $outputPath ($appName + "-" + $versionName + "-inrt-unsigned.apk")
$alignedDest = Join-Path $outputPath ($appName + "-" + $versionName + "-inrt-aligned.apk")
$dest = Join-Path $outputPath ($appName + "-" + $versionName + "-inrt.apk")
Copy-Item -LiteralPath $apk.FullName -Destination $unsignedDest -Force
$nativeLibRoot = Join-Path $AutoJs6Root "app\build\intermediates\merged_native_libs\inrtRelease\mergeInrtReleaseNativeLibs\out\lib"
Add-NativeLibrariesToApk -ApkPath $unsignedDest -NativeLibRoot $nativeLibRoot -Abis $NativeAbis

$keystoreDir = Split-Path $KeystorePath
New-Item -ItemType Directory -Force -Path $keystoreDir | Out-Null
if (-not (Test-Path $KeystorePath)) {
  & keytool `
    -genkeypair `
    -v `
    -keystore $KeystorePath `
    -storepass "agri_collector_dev" `
    -keypass "agri_collector_dev" `
    -alias "agri-video-collector" `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -dname "CN=AgriVideoCollector, OU=Dev, O=AutoCollection, L=Shenzhen, ST=Guangdong, C=CN"
}

if (Test-Path $alignedDest) {
  Remove-Item -LiteralPath $alignedDest -Force
}
if (Test-Path $dest) {
  Remove-Item -LiteralPath $dest -Force
}

& "$AndroidSdkRoot\build-tools\36.0.0\zipalign.exe" -p -f 4 $unsignedDest $alignedDest
Assert-LastCommandSucceeded "zipalign"
& "$AndroidSdkRoot\build-tools\36.0.0\apksigner.bat" sign `
  --ks $KeystorePath `
  --ks-key-alias "agri-video-collector" `
  --ks-pass "pass:agri_collector_dev" `
  --key-pass "pass:agri_collector_dev" `
  --out $dest `
  $alignedDest
Assert-LastCommandSucceeded "apksigner"

$sha256 = (Get-FileHash -Algorithm SHA256 $dest).Hash.ToLower()
Set-Content -Path "$dest.sha256" -Value $sha256 -Encoding ASCII

Remove-Item -LiteralPath $unsignedDest -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $alignedDest -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$dest.idsig" -Force -ErrorAction SilentlyContinue

Write-Host "APK packaged:"
Write-Host "  APK: $dest"
Write-Host "  SHA256: $sha256"

$arguments = @($args)
$server = "tcp:127.0.0.1:5037"
if ($env:ADB_SERVER_SOCKET) {
  $server = $env:ADB_SERVER_SOCKET
} elseif ($env:ANDROID_ADB_SERVER_PORT) {
  $server = "tcp:127.0.0.1:$($env:ANDROID_ADB_SERVER_PORT)"
}
$portIndex = [Array]::IndexOf($arguments, "-P")
if ($portIndex -ge 0) {
  $server = "tcp:127.0.0.1:$($arguments[$portIndex + 1])"
}
[pscustomobject]@{ Server = $server; Arguments = $arguments } |
  ConvertTo-Json -Compress | Add-Content -LiteralPath $env:FAKE_ADB_LOG

$global:LASTEXITCODE = 0
if ($arguments -contains "devices") {
  Write-Output "List of devices attached"
  $servers = $env:FAKE_ADB_SERVERS | ConvertFrom-Json
  $configuredServer = $servers.PSObject.Properties[$server]
  if ($configuredServer) {
    foreach ($device in $configuredServer.Value) {
      Write-Output "$($device.Serial)`t$($device.State)"
    }
  }
  return
}
if ($env:FAKE_ADB_ALLOW_MUTATIONS -ne "1") {
  throw "CheckOnly issued a non-discovery ADB command: $($arguments -join ' ')"
}
if ($arguments -contains "dumpsys") {
  Write-Output "versionName=1.0.0"
} else {
  Write-Output "Success"
}

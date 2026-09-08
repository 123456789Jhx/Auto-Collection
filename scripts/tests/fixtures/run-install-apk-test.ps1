$ErrorActionPreference = "Stop"

function Get-ItemProperty {
  [CmdletBinding()]
  param([string]$LiteralPath)
  if ($LiteralPath -ne "HKCU:\Environment") {
    throw "Unexpected registry access: $LiteralPath"
  }
  return ($env:FAKE_ADB_USER_ENV | ConvertFrom-Json)
}

function Get-NetTCPConnection {
  [CmdletBinding()]
  param([string]$State, [int]$LocalPort)
  if ($State -ne "Listen" -or $LocalPort -ne 5038) {
    throw "Unexpected listener query: $State $LocalPort"
  }
  if ($env:FAKE_ADB_LISTENER -eq "1") {
    [pscustomobject]@{ LocalAddress = "127.0.0.1"; LocalPort = 5038 }
  }
}

$parameters = @{}
$inputParameters = $env:FAKE_ADB_PARAMETERS | ConvertFrom-Json
foreach ($property in $inputParameters.PSObject.Properties) {
  $parameters[$property.Name] = $property.Value
}
try {
  & $env:FAKE_ADB_SCRIPT @parameters
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

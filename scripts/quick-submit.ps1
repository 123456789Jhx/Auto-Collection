param(
  [Parameter(Mandatory = $true)]
  [string]$Message,
  [string[]]$Paths = @(),
  [ValidateSet("none", "web", "full")]
  [string]$Verify = "web",
  [string[]]$Remotes = @("origin", "tomato"),
  [switch]$All,
  [switch]$IncludeUntracked,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Test-StagedChanges {
  & git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    return $false
  }
  if ($LASTEXITCODE -eq 1) {
    return $true
  }
  throw "git diff --cached --quiet failed with exit code $LASTEXITCODE"
}

function Enable-ExplicitGitSsh {
  $sshPath = "C:\Windows\System32\OpenSSH\ssh.exe"
  $keyPath = Join-Path $HOME ".ssh\id_ed25519"
  $knownHostsPath = Join-Path $HOME ".ssh\known_hosts"
  if ((Test-Path $sshPath) -and (Test-Path $keyPath)) {
    $env:GIT_SSH_COMMAND = "`"$sshPath`" -i `"$keyPath`" -o UserKnownHostsFile=`"$knownHostsPath`" -o StrictHostKeyChecking=accept-new"
    Write-Host "GIT_SSH_COMMAND enabled with local SSH key."
  } else {
    Write-Host "Local SSH key not found, using default Git SSH configuration."
  }
}

function Invoke-Verification([string]$Profile) {
  Write-Host "Running git diff --check"
  Invoke-Native "git" @("diff", "--check")
  Invoke-Native "git" @("diff", "--cached", "--check")

  if ($Profile -eq "none") {
    return
  }

  Invoke-Native "bun" @(
    "test",
    "account-data-platform/apps/web/tests/live-targets-page.test.js",
    "account-data-platform/apps/web/tests/navigation-dashboard-status.test.js"
  )
  Invoke-Native "bun" @("run", "--cwd", "account-data-platform/apps/web", "typecheck")
  Invoke-Native "bun" @("run", "--cwd", "account-data-platform", "lint")

  if ($Profile -eq "full") {
    Invoke-Native "bun" @("run", "--cwd", "account-data-platform", "build")
  }
}

Write-Host "Current git status:"
Invoke-Native "git" @("status", "--short")

if ($Paths.Count -gt 0) {
  Invoke-Native "git" (@("add", "--") + $Paths)
} elseif ($All) {
  Invoke-Native "git" @("add", "-u")
  if ($IncludeUntracked) {
    Invoke-Native "git" @("add", "--", ".")
  }
} else {
  throw "No paths were staged. Pass -Paths for exact files or -All for tracked changes."
}

if (-not (Test-StagedChanges)) {
  Write-Host "No staged changes to commit."
  exit 0
}

Invoke-Verification $Verify
Write-Host "Running git commit"
Invoke-Native "git" @("commit", "-m", $Message)

if ($NoPush) {
  Write-Host "NoPush was set, commit created without pushing."
  exit 0
}

Enable-ExplicitGitSsh
$remoteNames = (& git remote) | ForEach-Object { $_.Trim() } | Where-Object { $_ }
foreach ($remote in $Remotes) {
  if ($remoteNames -notcontains $remote) {
    Write-Warning "Remote '$remote' does not exist, skipped."
    continue
  }
  Write-Host "Running git push $remote"
  Invoke-Native "git" @("push", $remote, "HEAD:main")
}

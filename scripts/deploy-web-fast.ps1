param(
  [string]$HostName = "106.54.41.106",
  [int]$Port = 22,
  [string]$UserName = "ubuntu",
  [string]$Password = $env:DEPLOY_SSH_PASSWORD,
  [string]$DeployDir = "/opt/auto-collection/account-data-platform",
  [string]$ComposeFile = "docker-compose.production.yml",
  [string]$EnvFile = ".env.production",
  [string]$PublicUrl = "http://106.54.41.106:18080",
  [int]$HealthRetries = 30,
  [int]$HealthIntervalSeconds = 2
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($Password)) {
  throw "DEPLOY_SSH_PASSWORD or -Password is required."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Invoke-HealthCheck([string]$Url, [string]$ExpectedText) {
  for ($attempt = 1; $attempt -le $HealthRetries; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri $Url
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300 -and $response.Content -match $ExpectedText) {
        Write-Host "Health check passed: $Url"
        return
      }
    } catch {
      if ($attempt -eq $HealthRetries) {
        throw
      }
    }
    Start-Sleep -Seconds $HealthIntervalSeconds
  }
  throw "Health check failed: $Url"
}

$commit = (& git rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commit)) {
  throw "Cannot resolve current git commit."
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "auto-collection-deploy-$commit"
if (Test-Path $tempDir) {
  Remove-Item -LiteralPath $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$archivePath = Join-Path $tempDir "account-data-platform-$commit.tar"

try {
  Invoke-Native "git" @("archive", "--format=tar", "--output=$archivePath", "HEAD:account-data-platform")
  if (-not (Test-Path $archivePath)) {
    throw "Archive was not created: $archivePath"
  }

  $pythonScript = Join-Path $tempDir "deploy_web_fast.py"
  $pythonSource = @'
import os
import posixpath
import shlex
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    import paramiko
except ModuleNotFoundError:
    print("paramiko is required. Install it with: python -m pip install paramiko", file=sys.stderr)
    raise

host = os.environ["AC_DEPLOY_HOST"]
port = int(os.environ["AC_DEPLOY_PORT"])
username = os.environ["AC_DEPLOY_USER"]
password = os.environ["AC_DEPLOY_PASSWORD"]
deploy_dir = os.environ["AC_DEPLOY_DIR"]
compose_file = os.environ["AC_DEPLOY_COMPOSE_FILE"]
env_file = os.environ["AC_DEPLOY_ENV_FILE"]
archive_path = os.environ["AC_DEPLOY_ARCHIVE"]
commit = os.environ["AC_DEPLOY_COMMIT"]
remote_archive = f"/tmp/account-data-platform-{commit}.tar"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(
    hostname=host,
    port=port,
    username=username,
    password=password,
    look_for_keys=False,
    allow_agent=False,
    timeout=20,
)

try:
    sftp = client.open_sftp()
    try:
        sftp.put(archive_path, remote_archive)
    finally:
        sftp.close()

    command = f"""
set -euo pipefail
deploy_dir={shlex.quote(deploy_dir)}
compose_file={shlex.quote(compose_file)}
env_file={shlex.quote(env_file)}
archive={shlex.quote(remote_archive)}
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir" "$archive"' EXIT
mkdir -p "$deploy_dir" "$deploy_dir/public/downloads"
test -f "$deploy_dir/$env_file"
command -v rsync >/dev/null
tar -xf "$archive" -C "$work_dir"
rsync -a --delete \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='public/downloads/' \
  "$work_dir"/ "$deploy_dir"/
cd "$deploy_dir"
APP_PULL_POLICY=never docker compose --env-file "$env_file" -f "$compose_file" build web
APP_PULL_POLICY=never docker compose --env-file "$env_file" -f "$compose_file" up -d --no-deps web
docker compose --env-file "$env_file" -f "$compose_file" ps
"""

    print(f"Deploying commit {commit} to {host}:{deploy_dir}")
    _, stdout, _ = client.exec_command(command, get_pty=True)
    for line in stdout:
        print(line, end="")
    status = stdout.channel.recv_exit_status()
    if status != 0:
        raise SystemExit(status)
finally:
    client.close()
'@
  Set-Content -Path $pythonScript -Value $pythonSource -Encoding UTF8

  $env:AC_DEPLOY_HOST = $HostName
  $env:AC_DEPLOY_PORT = [string]$Port
  $env:AC_DEPLOY_USER = $UserName
  $env:AC_DEPLOY_PASSWORD = $Password
  $env:AC_DEPLOY_DIR = $DeployDir
  $env:AC_DEPLOY_COMPOSE_FILE = $ComposeFile
  $env:AC_DEPLOY_ENV_FILE = $EnvFile
  $env:AC_DEPLOY_ARCHIVE = $archivePath
  $env:AC_DEPLOY_COMMIT = $commit
  $env:PYTHONIOENCODING = "utf-8"

  Invoke-Native "python" @($pythonScript)

  $baseUrl = $PublicUrl.TrimEnd("/")
  Invoke-HealthCheck "$baseUrl/health" "ok"
  Invoke-HealthCheck "$baseUrl/ready" "ready"
} finally {
  Remove-Item Env:\AC_DEPLOY_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\AC_DEPLOY_HOST -ErrorAction SilentlyContinue
  Remove-Item Env:\AC_DEPLOY_PORT -ErrorAction SilentlyContinue
  Remove-Item Env:\AC_DEPLOY_USER -ErrorAction SilentlyContinue
  Remove-Item Env:\AC_DEPLOY_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:\AC_DEPLOY_COMPOSE_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:\AC_DEPLOY_ENV_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:\AC_DEPLOY_ARCHIVE -ErrorAction SilentlyContinue
  Remove-Item Env:\AC_DEPLOY_COMMIT -ErrorAction SilentlyContinue
  Remove-Item Env:\PYTHONIOENCODING -ErrorAction SilentlyContinue
  if (Test-Path $tempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force
  }
}

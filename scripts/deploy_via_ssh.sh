#!/usr/bin/env bash

set -euo pipefail

SSH_HOST="${SSH_HOST:-}"
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-}"
SSHPASS="${SSHPASS:-${SSH_PASSWORD:-}}"
DEPLOY_DIR="${DEPLOY_DIR:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
HEALTH_URL="${HEALTH_URL:-}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-3}"
RUN_DB_PUSH="${RUN_DB_PUSH:-true}"
APP_PULL_POLICY="${APP_PULL_POLICY:-never}"

if [ -z "$SSH_HOST" ] || [ -z "$SSH_USER" ] || [ -z "$SSHPASS" ]; then
  echo "SSH_HOST, SSH_USER, and SSHPASS are required"
  exit 1
fi

if [ -z "$DEPLOY_DIR" ]; then
  echo "DEPLOY_DIR is required"
  exit 1
fi

repo_source_path="account-data-platform"
repo_compose_path="$repo_source_path/$COMPOSE_FILE"
if [ ! -d "$repo_source_path" ] || [ ! -f "$repo_compose_path" ]; then
  echo "Deploy source not found in repository: $repo_source_path"
  exit 1
fi

export SSHPASS
ssh_opts=(
  -o StrictHostKeyChecking=accept-new
  -o ServerAliveInterval=20
  -o ServerAliveCountMax=3
  -p "$SSH_PORT"
)
scp_opts=(
  -o StrictHostKeyChecking=accept-new
  -o ServerAliveInterval=20
  -o ServerAliveCountMax=3
  -P "$SSH_PORT"
)
remote="${SSH_USER}@${SSH_HOST}"

echo "Preparing remote deploy directory: $DEPLOY_DIR"
sshpass -e ssh "${ssh_opts[@]}" "$remote" \
  "test -d '$DEPLOY_DIR' && mkdir -p '$DEPLOY_DIR/public/downloads' && test -f '$DEPLOY_DIR/.env'"

echo "Syncing application source to remote host"
COPYFILE_DISABLE=1 tar --no-xattrs --exclude='._*' --exclude='.DS_Store' --exclude='node_modules' --exclude='**/node_modules' --exclude='dist' --exclude='**/dist' --exclude='dist-types' --exclude='**/dist-types' -C "$repo_source_path" -czf - . |
  sshpass -e ssh "${ssh_opts[@]}" "$remote" \
    "set -euo pipefail; tmp_dir=\$(mktemp -d); tar -xzf - -C \"\$tmp_dir\"; find '$DEPLOY_DIR' -mindepth 1 -maxdepth 1 ! -name .env ! -name public -exec rm -rf {} +; find \"\$tmp_dir\" -name '._*' -o -name '.DS_Store' -delete; cp -a \"\$tmp_dir\"/. '$DEPLOY_DIR'/; rm -rf \"\$tmp_dir\"; mkdir -p '$DEPLOY_DIR/public/downloads'"

echo "Deploying remote compose stack"
sshpass -e ssh "${ssh_opts[@]}" "$remote" \
  "DEPLOY_DIR='$DEPLOY_DIR' COMPOSE_FILE='$COMPOSE_FILE' RUN_DB_PUSH='$RUN_DB_PUSH' APP_PULL_POLICY='$APP_PULL_POLICY' HEALTH_URL='$HEALTH_URL' HEALTH_RETRIES='$HEALTH_RETRIES' HEALTH_INTERVAL_SECONDS='$HEALTH_INTERVAL_SECONDS' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

cd "$DEPLOY_DIR"

echo "Deploy directory: $DEPLOY_DIR"
echo "Compose file: $COMPOSE_FILE"
echo "Runtime env file: $DEPLOY_DIR/.env"

if [ "$APP_PULL_POLICY" = "never" ]; then
  echo "APP_PULL_POLICY=never, skipping docker compose pull"
else
  docker compose -f "$COMPOSE_FILE" pull api web db-push
fi

docker compose -f "$COMPOSE_FILE" build api web db-push
docker compose -f "$COMPOSE_FILE" up -d postgres redis

if [ "$RUN_DB_PUSH" = "true" ]; then
  docker compose -f "$COMPOSE_FILE" run -T --rm db-push </dev/null
else
  echo "RUN_DB_PUSH=false, skipping database schema sync"
fi

echo "Starting API and web services"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans api web
docker compose -f "$COMPOSE_FILE" ps

if [ -z "$HEALTH_URL" ]; then
  echo "HEALTH_URL is empty, skipping health check"
  exit 0
fi

echo "Checking health: $HEALTH_URL"
for attempt in $(seq 1 "$HEALTH_RETRIES"); do
  if curl -fsS -m 5 "$HEALTH_URL"; then
    echo
    echo "Health check passed on attempt ${attempt}"
    exit 0
  fi

  if [ "$attempt" -lt "$HEALTH_RETRIES" ]; then
    sleep "$HEALTH_INTERVAL_SECONDS"
  fi
done

echo "Health check failed after ${HEALTH_RETRIES} attempts"
docker compose -f "$COMPOSE_FILE" ps
exit 1
REMOTE_SCRIPT

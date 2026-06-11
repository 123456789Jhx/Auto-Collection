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
GHCR_USER="${GHCR_USER:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"

if [ -z "$SSH_HOST" ] || [ -z "$SSH_USER" ] || [ -z "$SSHPASS" ]; then
  echo "SSH_HOST, SSH_USER, and SSHPASS are required"
  exit 1
fi

if [ -z "$DEPLOY_DIR" ]; then
  echo "DEPLOY_DIR is required"
  exit 1
fi

if [ -z "$GHCR_USER" ] || [ -z "$GHCR_TOKEN" ]; then
  echo "GHCR_USER and GHCR_TOKEN are required"
  exit 1
fi

repo_compose_path="account-data-platform/$COMPOSE_FILE"
if [ ! -f "$repo_compose_path" ]; then
  echo "Compose file not found in repository: $repo_compose_path"
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

echo "Syncing compose file to remote host"
sshpass -e scp "${scp_opts[@]}" "$repo_compose_path" "$remote:$DEPLOY_DIR/$COMPOSE_FILE"

echo "Logging in to GHCR on remote host"
printf '%s' "$GHCR_TOKEN" | sshpass -e ssh "${ssh_opts[@]}" "$remote" \
  "docker login ghcr.io -u '$GHCR_USER' --password-stdin >/dev/null"

echo "Deploying remote compose stack"
sshpass -e ssh "${ssh_opts[@]}" "$remote" \
  "DEPLOY_DIR='$DEPLOY_DIR' COMPOSE_FILE='$COMPOSE_FILE' RUN_DB_PUSH='$RUN_DB_PUSH' HEALTH_URL='$HEALTH_URL' HEALTH_RETRIES='$HEALTH_RETRIES' HEALTH_INTERVAL_SECONDS='$HEALTH_INTERVAL_SECONDS' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

cd "$DEPLOY_DIR"

echo "Deploy directory: $DEPLOY_DIR"
echo "Compose file: $COMPOSE_FILE"
echo "Runtime env file: $DEPLOY_DIR/.env"

docker compose -f "$COMPOSE_FILE" pull api web db-push
docker compose -f "$COMPOSE_FILE" up -d postgres redis

if [ "$RUN_DB_PUSH" = "true" ]; then
  docker compose -f "$COMPOSE_FILE" run --rm db-push
else
  echo "RUN_DB_PUSH=false, skipping database schema sync"
fi

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

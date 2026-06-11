#!/usr/bin/env bash

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
HEALTH_URL="${HEALTH_URL:-}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-3}"
RUN_DB_PUSH="${RUN_DB_PUSH:-true}"

if [ -z "$DEPLOY_DIR" ]; then
  echo "DEPLOY_DIR is required"
  exit 1
fi

if [ ! -d "$DEPLOY_DIR" ]; then
  echo "Deploy directory does not exist, creating: $DEPLOY_DIR"
  mkdir -p "$DEPLOY_DIR" || {
    echo "Failed to create DEPLOY_DIR: $DEPLOY_DIR"
    echo "Check the self-hosted runner user's permission for $(dirname "$DEPLOY_DIR")."
    exit 1
  }
fi

if [[ "$COMPOSE_FILE" = /* ]]; then
  compose_path="$COMPOSE_FILE"
  repo_compose_path="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/account-data-platform/$(basename "$COMPOSE_FILE")"
else
  compose_path="$DEPLOY_DIR/$COMPOSE_FILE"
  repo_compose_path="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/account-data-platform/$COMPOSE_FILE"
fi

if [ -f "$repo_compose_path" ] && [ "$repo_compose_path" != "$compose_path" ]; then
  echo "Syncing compose file from repo: $repo_compose_path -> $compose_path"
  mkdir -p "$(dirname "$compose_path")"
  docker run --rm \
    -v "$(dirname "$repo_compose_path"):/src:ro" \
    -v "$(dirname "$compose_path"):/dest" \
    alpine sh -lc \
    "cp '/src/$(basename "$repo_compose_path")' '/dest/$(basename "$compose_path")'"
fi

if [ ! -f "$compose_path" ]; then
  echo "Compose file not found: $compose_path"
  echo "Expected to sync it from repository file: $repo_compose_path"
  exit 1
fi

env_path="$DEPLOY_DIR/.env"
if [ ! -f "$env_path" ]; then
  echo "Runtime env file not found: $env_path"
  echo "Create it on the server before deployment and fill production secrets."
  echo "Use account-data-platform/.env.production.example as a reference."
  exit 1
fi

cd "$DEPLOY_DIR"
mkdir -p public/downloads

echo "Deploy directory: $DEPLOY_DIR"
echo "Compose file: $compose_path"
echo "Runtime env file: $env_path"

docker compose -f "$compose_path" pull api web db-push
docker compose -f "$compose_path" up -d postgres redis

if [ "$RUN_DB_PUSH" = "true" ]; then
  docker compose -f "$compose_path" run --rm db-push
else
  echo "RUN_DB_PUSH=false, skipping database schema sync"
fi

docker compose -f "$compose_path" up -d --remove-orphans api web
docker compose -f "$compose_path" ps

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
docker compose -f "$compose_path" ps
exit 1

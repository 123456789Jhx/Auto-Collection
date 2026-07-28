# Auto Collection Production Deploy

This deploy pack runs the agriculture collection backend as an isolated Docker Compose stack.
Normal production updates are handled by GitHub Actions:

1. `Docker Image CI` runs quality gates and validates the Docker builds.
2. `Deploy on Self-Hosted Runner` runs on the `dafengchan-deploy` runner, connects to the application host through `49.235.171.75:18082`, syncs `account-data-platform`, builds images on the server, and updates the Docker Compose stack.

## Ports

- Local web and API entry: `127.0.0.1:9026`
- API container internal port: `8080`
- PostgreSQL and Redis are container-internal only.

Tunnel target URLs:

- Web: `http://127.0.0.1:9026`
- Mobile API: `http://127.0.0.1:9026/api/v1`
- Health: `http://127.0.0.1:9026/health`

## Server Path

Recommended path:

```bash
/data/stacks/auto-collection
```

Application source is synced to:

```bash
/data/projects/auto-collection/account-data-platform
```

## First Deploy

```bash
mkdir -p /data/projects/auto-collection/account-data-platform /data/stacks/auto-collection/public/downloads
cd /data/stacks/auto-collection
cp /path/to/Auto-Collection/account-data-platform/.env.production.example .env
```

Edit `.env` and replace both passwords. Use letters and numbers only unless the password is URL-encoded, because the values are used inside database URLs.

The self-hosted deployment script syncs the application source from the repository, builds the images on the server, starts PostgreSQL and Redis, starts API and Web, and checks `/health`. Schema sync is skipped by default; set `RUN_DB_PUSH=true` only when a database schema update is intentional.

Check status:

```bash
docker compose -f docker-compose.production.yml ps
curl http://127.0.0.1:9026/health
curl http://127.0.0.1:9026/ready
```

## Update Deploy

Push to `main` or `master`; GitHub Actions builds the images and the self-hosted runner deploys automatically. You can also trigger both workflows manually from the GitHub Actions page.

## Mobile Agent URL

After this stack is up, set the AutoX mobile agent API base URL to:

```txt
http://127.0.0.1:9026/api/v1
```

Keep old FRP ports unchanged. Production domain binding should point Cloudflare Tunnel at the local service port.

# Auto Collection Production Deploy

This deploy pack runs the agriculture collection backend as an isolated Docker Compose stack.
Normal production updates are handled by GitHub Actions:

1. `Docker Image CI` builds and pushes `ghcr.io/dafengchan/auto-collection/api` and `ghcr.io/dafengchan/auto-collection/web`.
2. `Deploy on Self-Hosted Runner` runs on the `dafengchan-deploy` runner and updates the server stack with Docker Compose.

## Ports

- Public web and API entry: `18080`
- API container internal port: `8080`
- PostgreSQL and Redis are container-internal only.

Public URLs:

- Web: `http://106.54.41.106:18080`
- Mobile API: `http://106.54.41.106:18080/api/v1`
- Health: `http://106.54.41.106:18080/health`

## Server Path

Recommended path:

```bash
/opt/stacks/auto-collection
```

## First Deploy

```bash
cd /opt/stacks/auto-collection
cp /path/to/Auto-Collection/account-data-platform/.env.production.example .env
```

Edit `.env` and replace both passwords. Use letters and numbers only unless the password is URL-encoded, because the values are used inside database URLs.

The self-hosted deployment script syncs `docker-compose.production.yml` from the repository, pulls the latest GHCR images, starts PostgreSQL and Redis, runs `db-push`, starts API and Web, and checks `/ready`.

Check status:

```bash
docker compose -f docker-compose.production.yml ps
curl http://127.0.0.1:18080/health
curl http://127.0.0.1:18080/ready
```

## Update Deploy

Push to `main` or `master`; GitHub Actions builds the images and the self-hosted runner deploys automatically. You can also trigger both workflows manually from the GitHub Actions page.

## Mobile Agent URL

After this stack is up, set the AutoX mobile agent API base URL to:

```txt
http://106.54.41.106:18080/api/v1
```

Keep old FRP ports unchanged. This deployment does not use `3010`, `3023`, or `13010`.

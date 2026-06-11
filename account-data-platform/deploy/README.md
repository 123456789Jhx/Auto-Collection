# Auto Collection Production Deploy

This deploy pack runs the agriculture collection backend as an isolated Docker Compose stack.

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
/opt/auto-collection/account-data-platform
```

## First Deploy

```bash
cd /opt/auto-collection/account-data-platform
cp .env.production.example .env.production
```

Edit `.env.production` and replace both passwords. Use letters and numbers only unless the password is URL-encoded, because the values are used inside database URLs.

Build images:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml build
```

Start database and redis:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d postgres redis
```

Initialize or sync the database schema:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml run --rm db-push
```

Use this on the first empty production database. Do not pass `--force` unless you have reviewed the generated schema changes and accepted possible data loss.

Start API and web:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d api web
```

Check status:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl http://127.0.0.1:18080/health
curl http://127.0.0.1:18080/ready
```

## Update Deploy

```bash
cd /opt/auto-collection/account-data-platform
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml run --rm db-push
docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

## Mobile Agent URL

After this stack is up, set the AutoX mobile agent API base URL to:

```txt
http://106.54.41.106:18080/api/v1
```

Keep old FRP ports unchanged. This deployment does not use `3010`, `3023`, or `13010`.

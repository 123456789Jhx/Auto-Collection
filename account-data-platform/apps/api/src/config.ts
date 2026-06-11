export const config = {
  apiPort: Number(process.env.API_PORT ?? 3010),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:123456@localhost:5432/auto_collection",
  redisUrl: process.env.REDIS_URL ?? "redis://:123456@localhost:6379",
  tenantId: "default"
};

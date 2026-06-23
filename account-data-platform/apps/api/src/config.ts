export const config = {
  apiPort: Number(process.env.API_PORT ?? 3010),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://106.54.41.106:18080",
  agentDownloadDir: process.env.AGENT_DOWNLOAD_DIR ?? "dist/agent",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:123456@localhost:5432/auto_collection",
  redisUrl: process.env.REDIS_URL ?? "redis://:123456@localhost:6379",
  tenantId: "default",
  jwtSecret: process.env.JWT_SECRET ?? "local-dev-jwt-secret",
  adminUsername: process.env.ADMIN_USERNAME ?? "root",
  adminPassword: process.env.ADMIN_PASSWORD ?? "root",
  adminTokenTtlSeconds: Number(process.env.ADMIN_TOKEN_TTL_SECONDS ?? 86400),
  mobileRegistrationSecret: process.env.MOBILE_REGISTRATION_SECRET ?? "",
  mobileRequestSigningRequired: process.env.MOBILE_REQUEST_SIGNING_REQUIRED === "true",
  mobileRequestTimestampSkewSeconds: Number(process.env.MOBILE_REQUEST_TIMESTAMP_SKEW_SECONDS ?? 300)
};

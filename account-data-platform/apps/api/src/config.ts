type EnvMap = Record<string, string | undefined>;

const weakProductionValues = new Set([
  "",
  "change_this_admin_token_secret",
  "local-dev-jwt-secret"
]);

function requireProductionValue(name: string, value: string, isProduction: boolean) {
  if (!isProduction) {
    return;
  }
  if (weakProductionValues.has(value) || (name !== "ADMIN_PASSWORD" && value === "root")) {
    throw new Error(`${name} must be configured for production`);
  }
}

export function resolveConfig(env: EnvMap = process.env) {
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const jwtSecret = env.JWT_SECRET ?? (isProduction ? "" : "local-dev-jwt-secret");
  const adminPassword = env.ADMIN_PASSWORD ?? (isProduction ? "" : "root");
  const mobileRegistrationSecret = env.MOBILE_REGISTRATION_SECRET ?? "";
  const mobileRequestSigningRequired = env.MOBILE_REQUEST_SIGNING_REQUIRED === "true";

  requireProductionValue("JWT_SECRET", jwtSecret, isProduction);
  requireProductionValue("ADMIN_PASSWORD", adminPassword, isProduction);
  requireProductionValue("MOBILE_REGISTRATION_SECRET", mobileRegistrationSecret, isProduction);
  if (isProduction && !mobileRequestSigningRequired) {
    throw new Error("MOBILE_REQUEST_SIGNING_REQUIRED must be true for production");
  }

  return {
    apiPort: Number(env.API_PORT ?? 3012),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? "http://localhost:3012",
    agentDownloadDir: env.AGENT_DOWNLOAD_DIR ?? "dist/agent",
    databaseUrl: env.DATABASE_URL ?? "postgres://postgres:123456@localhost:5432/auto_collection",
    redisUrl: env.REDIS_URL ?? "redis://:123456@localhost:6379",
    tenantId: "default",
    jwtSecret,
    adminUsername: env.ADMIN_USERNAME ?? "root",
    adminPassword,
    adminTokenTtlSeconds: Number(env.ADMIN_TOKEN_TTL_SECONDS ?? 86400),
    mobileRegistrationSecret,
    mobileRequestSigningRequired,
    mobileRequestTimestampSkewSeconds: Number(env.MOBILE_REQUEST_TIMESTAMP_SKEW_SECONDS ?? 300)
  };
}

export const config = resolveConfig();

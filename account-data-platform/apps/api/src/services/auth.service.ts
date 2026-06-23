import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

export type AdminSession = {
  username: string;
  role: "admin";
  expiresAt: string;
};

type TokenPayload = {
  username: string;
  role: "admin";
  exp: number;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string) {
  return createHmac("sha256", config.jwtSecret).update(value, "utf8").digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function credentialsMatch(username: string, password: string) {
  return safeEqual(username, config.adminUsername) && safeEqual(password, config.adminPassword);
}

function createToken(payload: TokenPayload) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function loginAdmin(username: string, password: string) {
  if (!credentialsMatch(username, password)) {
    return null;
  }

  const expiresAtSeconds = Math.floor(Date.now() / 1000) + config.adminTokenTtlSeconds;
  const token = createToken({
    username: config.adminUsername,
    role: "admin",
    exp: expiresAtSeconds
  });

  return {
    token,
    user: {
      username: config.adminUsername,
      role: "admin" as const,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
    }
  };
}

export function verifyAdminToken(token: string): AdminSession | null {
  const [header, body, signature, ...extra] = token.split(".");
  if (!header || !body || !signature || extra.length) {
    return null;
  }

  const unsigned = `${header}.${body}`;
  if (!safeEqual(signature, sign(unsigned))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as Partial<TokenPayload>;
    if (payload.username !== config.adminUsername || payload.role !== "admin" || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      username: payload.username,
      role: "admin",
      expiresAt: new Date(payload.exp * 1000).toISOString()
    };
  } catch {
    return null;
  }
}

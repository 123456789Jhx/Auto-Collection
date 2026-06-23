import type { Context, Next } from "hono";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { findDeviceByCode, findDeviceByToken } from "../repositories/device.repository";

type MobileVariables = {
  mobileBody: Record<string, unknown>;
  clientIp: string;
  deviceToken: string;
};

function getClientIp(c: Context) {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    c.req.header("cf-connecting-ip") ||
    ""
  );
}

async function readBody(c: Context) {
  const contentType = c.req.header("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {};
  }
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function mobileAuthError(code: string, message: string, status: 400 | 401 | 403, details: Record<string, unknown> = {}) {
  return { error: { code, message, details }, status };
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256Hex(secret: string, value: string) {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function safeEqualHex(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function canonicalBody(body: Record<string, unknown>) {
  return Object.keys(body).length ? JSON.stringify(body) : "";
}

function signatureBase(c: Context, timestamp: string, bodyHash: string) {
  const url = new URL(c.req.url);
  return [
    c.req.method.toUpperCase(),
    url.pathname,
    url.search.startsWith("?") ? url.search.slice(1) : url.search,
    timestamp,
    bodyHash
  ].join("\n");
}

function verifyMobileSignature(c: Context, body: Record<string, unknown>, deviceToken: string, required = config.mobileRequestSigningRequired) {
  const timestamp = c.req.header("x-timestamp") || "";
  const bodyHash = c.req.header("x-body-sha256") || "";
  const signature = c.req.header("x-signature") || "";
  const hasSignatureHeaders = !!timestamp || !!bodyHash || !!signature;

  if (!required && !hasSignatureHeaders) {
    return null;
  }

  if (!timestamp || !bodyHash || !signature) {
    return mobileAuthError("SIGNATURE_REQUIRED", "Mobile request signature is required", 401);
  }

  const timestampMs = Date.parse(timestamp);
  const skewMs = Math.max(30, config.mobileRequestTimestampSkewSeconds) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > skewMs) {
    return mobileAuthError("SIGNATURE_EXPIRED", "Mobile request timestamp is expired", 401, { timestamp });
  }

  const expectedBodyHash = sha256Hex(canonicalBody(body));
  if (!safeEqualHex(bodyHash, expectedBodyHash)) {
    return mobileAuthError("BODY_HASH_MISMATCH", "Mobile request body hash mismatch", 401);
  }

  const expectedSignature = hmacSha256Hex(deviceToken, signatureBase(c, timestamp, bodyHash));
  if (!safeEqualHex(signature, expectedSignature)) {
    return mobileAuthError("SIGNATURE_INVALID", "Mobile request signature is invalid", 401);
  }

  return null;
}

export async function mobileAuth(c: Context<{ Variables: MobileVariables }>, next: Next) {
  const queryDeviceId = c.req.query("deviceCode") || c.req.query("deviceId");
  const body = c.req.method === "GET" ? {} : ((await readBody(c)) as Record<string, unknown>);
  const deviceId = queryDeviceId || (typeof body.deviceCode === "string" ? body.deviceCode : "") || (typeof body.deviceId === "string" ? body.deviceId : "");
  const requestDeviceToken = c.req.header("x-device-token") || c.req.query("deviceToken") || (typeof body.deviceToken === "string" ? body.deviceToken : "");

  c.set("mobileBody", body);
  c.set("clientIp", getClientIp(c));
  c.set("deviceToken", requestDeviceToken);

  if (c.req.path.endsWith("/mobile/device-token/register")) {
    await next();
    return;
  }

  if (!deviceId) {
    const result = mobileAuthError("DEVICE_ID_REQUIRED", "deviceId is required", 400);
    return c.json({ error: result.error }, result.status);
  }

  const device = await findDeviceByCode(deviceId);
  if (!device) {
    const result = mobileAuthError("DEVICE_UNREGISTERED", "Device is not registered", 401, { deviceId });
    return c.json({ error: result.error }, result.status);
  }

  if (!device.enabled) {
    const result = mobileAuthError("DEVICE_DISABLED", "Device is disabled", 403, { deviceId });
    return c.json({ error: result.error }, result.status);
  }

  if (requestDeviceToken) {
    const tokenDevice = await findDeviceByToken(requestDeviceToken);
    if (!tokenDevice || tokenDevice.deviceCode !== deviceId) {
      const result = mobileAuthError("DEVICE_TOKEN_MISMATCH", "Device token does not match deviceId", 401, { deviceId });
      return c.json({ error: result.error }, result.status);
    }
  }

  const trustedDeviceToken = requestDeviceToken || device.deviceToken || "";
  if (!trustedDeviceToken) {
    const result = mobileAuthError("DEVICE_TOKEN_REQUIRED", "Device token is not bound", 401, { deviceId });
    return c.json({ error: result.error }, result.status);
  }

  const signatureError = verifyMobileSignature(c, body, trustedDeviceToken, !requestDeviceToken || config.mobileRequestSigningRequired);
  if (signatureError) {
    return c.json({ error: signatureError.error }, signatureError.status);
  }

  c.set("deviceToken", trustedDeviceToken);
  await next();
}

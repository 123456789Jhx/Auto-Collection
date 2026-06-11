import type { Context, Next } from "hono";
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

export async function mobileAuth(c: Context<{ Variables: MobileVariables }>, next: Next) {
  const queryDeviceId = c.req.query("deviceId");
  const body = c.req.method === "GET" ? {} : ((await readBody(c)) as Record<string, unknown>);
  const deviceId = queryDeviceId || (typeof body.deviceId === "string" ? body.deviceId : "");
  const deviceToken = c.req.header("x-device-token") || c.req.query("deviceToken") || (typeof body.deviceToken === "string" ? body.deviceToken : "");

  c.set("mobileBody", body);
  c.set("clientIp", getClientIp(c));
  c.set("deviceToken", deviceToken);

  if (c.req.path.endsWith("/mobile/device-token/register")) {
    await next();
    return;
  }

  if (!deviceId) {
    const result = mobileAuthError("DEVICE_ID_REQUIRED", "deviceId is required", 400);
    return c.json({ error: result.error }, result.status);
  }

  if (!deviceToken) {
    const result = mobileAuthError("DEVICE_TOKEN_REQUIRED", "X-Device-Token is required", 401, { deviceId });
    return c.json({ error: result.error }, result.status);
  }

  const tokenDevice = await findDeviceByToken(deviceToken);
  if (tokenDevice) {
    if (!tokenDevice.enabled) {
      const result = mobileAuthError("DEVICE_DISABLED", "Device is disabled", 403, { deviceId: tokenDevice.deviceCode });
      return c.json({ error: result.error }, result.status);
    }
    await next();
    return;
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

  if (!device.deviceToken) {
    const result = mobileAuthError("DEVICE_TOKEN_REQUIRED", "Device token is not bound", 401, { deviceId });
    return c.json({ error: result.error }, result.status);
  }

  const result = mobileAuthError("DEVICE_UNAUTHORIZED", "Device token mismatch", 401, { deviceId });
  return c.json({ error: result.error }, result.status);
}

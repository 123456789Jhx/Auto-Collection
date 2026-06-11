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
    await next();
    return;
  }

  const tokenDevice = deviceToken ? await findDeviceByToken(deviceToken) : null;
  if (tokenDevice) {
    if (!tokenDevice.enabled) {
      return c.json({ error: { code: "DEVICE_DISABLED", message: "设备已禁用", details: { deviceId: tokenDevice.deviceCode } } }, 403);
    }
    await next();
    return;
  }

  const device = await findDeviceByCode(deviceId);
  if (!device) {
    await next();
    return;
  }

  if (!device.enabled) {
    return c.json({ error: { code: "DEVICE_DISABLED", message: "设备已禁用", details: { deviceId } } }, 403);
  }

  if (device.deviceToken && device.deviceToken !== deviceToken) {
    return c.json({ error: { code: "DEVICE_UNAUTHORIZED", message: "设备鉴权失败", details: { deviceId } } }, 401);
  }

  await next();
}

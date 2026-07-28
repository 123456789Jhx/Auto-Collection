import { Hono } from "hono";
import { mobileAuth } from "../middleware/mobile-auth";
import { getRemoteScriptConfigForDevice } from "../services/remote-script.service";

type MobileVariables = {
  mobileBody: Record<string, unknown>;
  clientIp: string;
  deviceToken: string;
};

export const mobileRemoteScriptRoutes = new Hono<{ Variables: MobileVariables }>();

mobileRemoteScriptRoutes.use("*", mobileAuth);

mobileRemoteScriptRoutes.get("/configs/:scriptKey", async (c) => {
  const deviceId = c.req.query("deviceId");
  if (!deviceId) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "deviceId is required", details: {} } }, 400);
  }
  const savedConfig = await getRemoteScriptConfigForDevice(deviceId, c.req.param("scriptKey"));
  return c.json({ data: savedConfig });
});

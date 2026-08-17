import { deviceRecoveryStageReportSchema } from "@pkg/types";
import { Hono } from "hono";
import { ZodError } from "zod";
import type { createDeviceRecoveryService } from "./device-recovery.service";

type DeviceRecoveryService = ReturnType<typeof createDeviceRecoveryService>;
type MobileVariables = { mobileBody?: Record<string, unknown> };

function errorStatus(error: unknown): 400 | 404 | 409 {
  if (error instanceof ZodError || error instanceof SyntaxError) return 400;
  const code = error instanceof Error ? error.message : "";
  if (code === "DEVICE_NOT_FOUND" || code === "RECOVERY_SESSION_NOT_FOUND") return 404;
  return 409;
}

function errorCode(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError) return "VALIDATION_ERROR";
  return error instanceof Error ? error.message : "DEVICE_RECOVERY_FAILED";
}

export function createDeviceRecoveryRoutes(dependencies: { service: DeviceRecoveryService }) {
  const mobile = new Hono<{ Variables: MobileVariables }>();
  const admin = new Hono();

  mobile.post("/stages", async (c) => {
    try {
      const authenticatedBody = c.get("mobileBody");
      const body = deviceRecoveryStageReportSchema.parse(
        authenticatedBody && Object.keys(authenticatedBody).length ? authenticatedBody : await c.req.json()
      );
      return c.json({ data: await dependencies.service.reportStage(body) }, 202);
    } catch (error) {
      return c.json({ error: { code: errorCode(error), message: "Device recovery stage report was rejected", details: {} } }, errorStatus(error));
    }
  });

  admin.get("/devices/:deviceId/latest", async (c) => {
    try {
      const result = await dependencies.service.getLatest(c.req.param("deviceId"));
      if (!result) {
        return c.json({ error: { code: "RECOVERY_SESSION_NOT_FOUND", message: "No device recovery session was found", details: {} } }, 404);
      }
      return c.json({ data: result });
    } catch (error) {
      return c.json({ error: { code: errorCode(error), message: "Device recovery session could not be loaded", details: {} } }, errorStatus(error));
    }
  });

  return { mobile, admin };
}

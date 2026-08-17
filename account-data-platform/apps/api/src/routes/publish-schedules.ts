import { Hono, type Context } from "hono";
import type { PublishAccountBinding, PublishDeviceSchedule } from "@pkg/types";
import { publishAccountBindingSchema, publishDeviceScheduleSchema } from "@pkg/types";
import type { AdminVariables } from "../middleware/admin-auth";
import { publishVideoConfigSchema } from "../services/publish-config";
import { getRemoteScriptConfig, RemoteScriptServiceError } from "../services/remote-script.service";
import { testConnection, WecomPublishClientError } from "../services/wecom-publish-client";
import {
  listPublishAccountBindings,
  listPublishDeviceSchedules,
  savePublishAccountBinding,
  savePublishDeviceSchedule
} from "../repositories/publish-routing.repository";

type AdminContext = Context<{ Variables: AdminVariables }>;

function errorResponse(c: AdminContext, error: unknown) {
  if (error instanceof RemoteScriptServiceError) {
    return c.json({ error: { code: error.message, message: error.userMessage } }, 404);
  }
  if (error instanceof WecomPublishClientError) {
    return c.json({ error: { code: error.code, message: error.userMessage } }, 502);
  }
  throw error;
}

async function getExternalPublishConfig(configId: string) {
  const config = await getRemoteScriptConfig(configId);
  if (config.scriptKey !== "publish_video") {
    throw new RemoteScriptServiceError("NOT_FOUND", "接口定时配置不存在", { configId });
  }
  const parsed = publishVideoConfigSchema.safeParse({
    ...config.configPayload,
    sourceMode: config.configPayload.sourceMode ?? "external_pull"
  });
  if (!parsed.success || parsed.data.sourceMode !== "external_pull") {
    throw new RemoteScriptServiceError("NOT_FOUND", "接口定时配置不存在", { configId });
  }
  return parsed.data;
}

export const publishScheduleRoutes = new Hono<{ Variables: AdminVariables }>();

publishScheduleRoutes.get("/device-bindings", async (c) => {
  return c.json({ data: await listPublishAccountBindings(c.req.query("deviceCode")) });
});

publishScheduleRoutes.put("/device-bindings", async (c) => {
  const parsed = publishAccountBindingSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid publish account binding", details: parsed.error.flatten() } }, 400);
  try {
    return c.json(await savePublishAccountBinding(parsed.data as PublishAccountBinding, c.get("admin").username));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return c.json({ error: { code: "PUBLISH_ACCOUNT_BINDING_CONFLICT", message: "The account is already bound to another device" } }, 409);
    }
    throw error;
  }
});

publishScheduleRoutes.get("/device-plans", async (c) => {
  return c.json({ data: await listPublishDeviceSchedules(c.req.query("configId")) });
});

publishScheduleRoutes.put("/device-plans", async (c) => {
  const parsed = publishDeviceScheduleSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid publish device schedule", details: parsed.error.flatten() } }, 400);
  const saved = await savePublishDeviceSchedule(parsed.data as PublishDeviceSchedule, c.get("admin").username);
  return c.json(saved);
});

publishScheduleRoutes.post("/:configId/test-connection", async (c) => {
  try {
    const publishConfig = await getExternalPublishConfig(c.req.param("configId"));
    return c.json(await testConnection(publishConfig));
  } catch (error) {
    return errorResponse(c, error);
  }
});

import { publishTaskResultPayloadSchema } from "@pkg/types";
import { Hono } from "hono";
import { validationError } from "../lib/validation";
import { mobileAuth } from "../middleware/mobile-auth";
import { getPublishTaskTopicResolution, reportPublishTaskResult } from "../services/publish-task-result.service";
import { WecomPublishClientError } from "../services/wecom-publish-client";

type MobileVariables = {
  mobileBody: Record<string, unknown>;
  clientIp: string;
  deviceToken: string;
};

export const mobilePublishTaskRoutes = new Hono<{ Variables: MobileVariables }>();

mobilePublishTaskRoutes.use("*", mobileAuth);

mobilePublishTaskRoutes.get("/:id/topics", async (c) => {
  const deviceId = c.req.query("deviceId") || "";
  if (!deviceId) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "deviceId is required", details: {} } }, 400);
  }
  try {
    return c.json(await getPublishTaskTopicResolution(c.req.param("id"), deviceId));
  } catch (error) {
    const code = String(error instanceof Error ? error.message : error);
    if (code === "PUBLISH_TASK_NOT_FOUND") {
      return c.json({ error: { code, message: "发布任务不存在", details: {} } }, 404);
    }
    if (code === "PUBLISH_TASK_DEVICE_MISMATCH") {
      return c.json({ error: { code, message: "发布任务不属于当前设备", details: {} } }, 403);
    }
    throw error;
  }
});

mobilePublishTaskRoutes.post("/:id/result", async (c) => {
  const parsed = publishTaskResultPayloadSchema.safeParse(c.get("mobileBody"));
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    const result = {
      deviceId: parsed.data.deviceId,
      status: parsed.data.status,
      error: parsed.data.error,
      publishedUrl: parsed.data.publishedUrl,
      platformContentId: parsed.data.platformContentId
    };
    return c.json(await reportPublishTaskResult(
      c.req.param("id"),
      result,
      `mobile:${parsed.data.deviceId}`
    ));
  } catch (error) {
    if (error instanceof WecomPublishClientError) {
      return c.json({
        error: { code: error.code, message: error.userMessage, details: { upstreamStatus: error.status } }
      }, 502);
    }
    const code = String(error instanceof Error ? error.message : error);
    if (code === "PUBLISH_TASK_NOT_FOUND") {
      return c.json({ error: { code, message: "发布任务不存在", details: {} } }, 404);
    }
    if (code === "PUBLISH_TASK_DEVICE_MISMATCH") {
      return c.json({ error: { code, message: "发布任务不属于当前设备", details: {} } }, 403);
    }
    throw error;
  }
});

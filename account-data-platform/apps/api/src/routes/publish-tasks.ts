import {
  completePublishTopicsPayloadSchema,
  manualPublishTestPayloadSchema
} from "@pkg/types";
import { Hono } from "hono";
import { validationError } from "../lib/validation";
import type { AdminVariables } from "../middleware/admin-auth";
import { getPublishTaskDashboard } from "../repositories/publish-dispatch.repository";
import { RemoteScriptServiceError } from "../services/remote-script.service";
import { dispatchExistingPublishTaskNow } from "../services/publish-scheduler.service";
import { completePublishTaskTopics } from "../services/publish-task-result.service";
import { PublishTopicsValidationError } from "../services/publish-topics";
import {
  createManualPublishTest,
  ManualPublishTestServiceError
} from "../services/manual-publish-test.service";

export const publishTaskRoutes = new Hono<{ Variables: AdminVariables }>();

publishTaskRoutes.get("/", async (c) => c.json(await getPublishTaskDashboard()));

publishTaskRoutes.post("/:id/dispatch-single", async (c) => {
  try {
    return c.json(await dispatchExistingPublishTaskNow(c.req.param("id"), c.get("admin").username));
  } catch (error) {
    const code = String(error instanceof Error ? error.message : error);
    if (code === "PUBLISH_TASK_NOT_FOUND") {
      return c.json({ error: { code, message: "发布任务不存在", details: {} } }, 404);
    }
    if (code === "PUBLISH_TASK_DIRECT_DISPATCH_SOURCE_INVALID") {
      return c.json({ error: { code, message: "仅外部接口任务可单条直发", details: {} } }, 409);
    }
    if (code === "PUBLISH_TASK_DIRECT_DISPATCH_STATE_INVALID") {
      return c.json({ error: { code, message: "该任务当前状态不可再次下发", details: {} } }, 409);
    }
    if (code === "PUBLISH_TASK_DEVICE_NOT_MATCHED") {
      return c.json({ error: { code, message: "未找到绑定该账号的在线设备", details: {} } }, 409);
    }
    if (error instanceof RemoteScriptServiceError) {
      return c.json({ error: { code: error.message, message: error.userMessage, details: error.details } }, 404);
    }
    throw error;
  }
});

publishTaskRoutes.post("/manual-test", async (c) => {
  const parsed = manualPublishTestPayloadSchema.safeParse(await c.req.json());
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    return c.json(await createManualPublishTest(parsed.data, c.get("admin").username));
  } catch (error) {
    if (error instanceof ManualPublishTestServiceError || error instanceof RemoteScriptServiceError) {
      return c.json({
        error: { code: error.message, message: error.userMessage, details: {} }
      }, 400);
    }
    throw error;
  }
});

publishTaskRoutes.post("/:id/topics", async (c) => {
  const parsed = completePublishTopicsPayloadSchema.safeParse(await c.req.json());
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    return c.json(await completePublishTaskTopics(
      c.req.param("id"),
      parsed.data.description,
      c.get("admin").username
    ));
  } catch (error) {
    if (error instanceof PublishTopicsValidationError) {
      return c.json({
        error: { code: error.code, message: error.userMessage, details: {} }
      }, 400);
    }
    const code = String(error instanceof Error ? error.message : error);
    if (code === "PUBLISH_TASK_NOT_FOUND") {
      return c.json({ error: { code, message: "发布任务不存在", details: {} } }, 404);
    }
    if (code === "PUBLISH_TASK_TOPIC_STATE_INVALID") {
      return c.json({ error: { code, message: "仅待补全话题任务可重新下发", details: {} } }, 409);
    }
    throw error;
  }
});

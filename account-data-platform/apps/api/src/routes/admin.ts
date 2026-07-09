import { createAgentVersionSchema, createMobileCommandSchema, createTaskAssignmentSchema, updateDeviceSchema, updateDeviceTaskConfigSchema, updateTaskSchema } from "@pkg/types";
import { Hono } from "hono";
import { z } from "zod";
import { validationError } from "../lib/validation";
import { adminAuth, type AdminVariables } from "../middleware/admin-auth";
import { loginAdmin } from "../services/auth.service";
import { createCommand, getCommands } from "../services/command.service";
import { clearDeviceToken, deleteDeviceRecord, getDeviceDailyProgress, getDeviceProgressHistory, getDeviceTaskConfig, getDevices, getLiveCommentActions, getLiveCommentDeviceSummary, getLogDates, getLogDeviceSummary, getLogFileDates, getLogFileDetail, getLogFiles, getLogs, getOverview, getRecordDates, getRecordDeviceSummary, getRecords, getTasks, rotateDeviceToken, updateDevice, updateDeviceTaskConfig, updateTaskConfig } from "../services/admin.service";
import { getAgentVersions, publishAgentVersion } from "../services/agent-version.service";
import { createTaskAssignmentFromAdmin, getTaskAssignments } from "../services/task-orchestrator.service";
import { deleteLiveTarget, listLiveTargetDetails, replaceLiveTargetDeviceBindings, upsertLiveTarget, upsertLiveTargetFeatureConfig } from "../repositories/live-target.repository";
import { liveTargetFeatureConfigSchema, liveTargetFeatureTypeSchema, liveTargetPayloadSchema } from "../services/live-target-config.service";

const adminLoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

const liveTargetDeviceBindingsSchema = z.object({
  targetId: z.string().uuid(),
  featureType: liveTargetFeatureTypeSchema,
  deviceCodes: z.array(z.string().trim().min(1).max(64)).max(200).default([]),
  defaultEnabled: z.boolean().default(false)
});

export const adminRoutes = new Hono<{ Variables: AdminVariables }>();

adminRoutes.post("/auth/login", async (c) => {
  const parsed = adminLoginSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }

  const result = loginAdmin(parsed.data.username, parsed.data.password);
  if (!result) {
    return c.json({ error: { code: "ADMIN_LOGIN_FAILED", message: "Invalid username or password", details: {} } }, 401);
  }

  return c.json(result);
});

adminRoutes.use("*", adminAuth);

adminRoutes.get("/auth/me", async (c) => c.json({ user: c.get("admin") }));
adminRoutes.get("/overview", async (c) => c.json(await getOverview()));
adminRoutes.get("/devices", async (c) => c.json(await getDevices()));
adminRoutes.patch("/devices/:deviceCode", async (c) => {
  const parsed = updateDeviceSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  return c.json(await updateDevice(c.req.param("deviceCode"), parsed.data));
});
adminRoutes.delete("/devices/:deviceCode", async (c) => c.json(await deleteDeviceRecord(c.req.param("deviceCode"))));
adminRoutes.post("/devices/:deviceCode/token", async (c) => c.json(await rotateDeviceToken(c.req.param("deviceCode"))));
adminRoutes.delete("/devices/:deviceCode/token", async (c) => c.json(await clearDeviceToken(c.req.param("deviceCode"))));
adminRoutes.get("/devices/:deviceCode/task-config", async (c) => c.json(await getDeviceTaskConfig(c.req.param("deviceCode"), c.req.query("platform") ?? "douyin")));
adminRoutes.get("/devices/:deviceCode/progress-history", async (c) => c.json(await getDeviceProgressHistory(c.req.param("deviceCode"), c.req.query())));
adminRoutes.get("/devices/:deviceCode/daily-progress", async (c) => c.json(await getDeviceDailyProgress(c.req.param("deviceCode"), c.req.query())));
adminRoutes.patch("/devices/:deviceCode/task-config", async (c) => {
  const parsed = updateDeviceTaskConfigSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  return c.json(await updateDeviceTaskConfig(c.req.param("deviceCode"), parsed.data, c.req.query("platform") ?? "douyin"));
});
adminRoutes.get("/collection-records", async (c) => c.json(await getRecords(c.req.query())));
adminRoutes.get("/collection-record-device-summary", async (c) => c.json(await getRecordDeviceSummary(c.req.query())));
adminRoutes.get("/live-comment-actions", async (c) => c.json(await getLiveCommentActions(c.req.query())));
adminRoutes.get("/live-comment-device-summary", async (c) => c.json(await getLiveCommentDeviceSummary(c.req.query())));
adminRoutes.get("/devices/:deviceCode/collection-record-dates", async (c) => c.json(await getRecordDates(c.req.param("deviceCode"))));
adminRoutes.get("/runtime-logs", async (c) => c.json(await getLogs(c.req.query())));
adminRoutes.get("/runtime-log-device-summary", async (c) => c.json(await getLogDeviceSummary(c.req.query())));
adminRoutes.get("/devices/:deviceCode/runtime-log-dates", async (c) => c.json(await getLogDates(c.req.param("deviceCode"))));
adminRoutes.get("/log-files", async (c) => c.json(await getLogFiles(c.req.query())));
adminRoutes.get("/log-files/:id", async (c) => c.json(await getLogFileDetail(c.req.param("id"))));
adminRoutes.get("/devices/:deviceCode/log-file-dates", async (c) => c.json(await getLogFileDates(c.req.param("deviceCode"))));
adminRoutes.get("/tasks", async (c) => c.json(await getTasks()));
adminRoutes.patch("/tasks/:id", async (c) => {
  const parsed = updateTaskSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  return c.json(await updateTaskConfig(c.req.param("id"), parsed.data));
});
adminRoutes.get("/live-targets", async (c) => c.json(await listLiveTargetDetails(c.req.query("platform") ?? "douyin")));
adminRoutes.post("/live-targets", async (c) => {
  const parsed = liveTargetPayloadSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  const result = await upsertLiveTarget(parsed.data);
  if (!result) {
    return c.json({ error: { code: "LIVE_TARGET_SAVE_FAILED", message: "直播目标保存失败", details: {} } }, 400);
  }
  return c.json(result, 201);
});
adminRoutes.patch("/live-targets/:id", async (c) => {
  const parsed = liveTargetPayloadSchema.safeParse({ ...(await c.req.json()), id: c.req.param("id") });
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  const result = await upsertLiveTarget(parsed.data);
  if (!result) {
    return c.json({ error: { code: "LIVE_TARGET_NOT_FOUND", message: "直播目标不存在", details: {} } }, 404);
  }
  return c.json(result);
});
adminRoutes.delete("/live-targets/:id", async (c) => {
  const result = await deleteLiveTarget(c.req.param("id"));
  if (!result) {
    return c.json({ error: { code: "LIVE_TARGET_NOT_FOUND", message: "直播目标不存在", details: {} } }, 404);
  }
  return c.json({ success: true });
});
adminRoutes.post("/live-targets/:id/feature-configs", async (c) => {
  const parsed = liveTargetFeatureConfigSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  const result = await upsertLiveTargetFeatureConfig(c.req.param("id"), parsed.data);
  if (!result) {
    return c.json({ error: { code: "LIVE_TARGET_NOT_FOUND", message: "直播目标不存在", details: {} } }, 404);
  }
  return c.json(result);
});
adminRoutes.post("/live-target-device-bindings", async (c) => {
  const parsed = liveTargetDeviceBindingsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  const result = await replaceLiveTargetDeviceBindings(parsed.data);
  if (!result) {
    return c.json({ error: { code: "LIVE_TARGET_NOT_FOUND", message: "直播目标不存在", details: {} } }, 404);
  }
  return c.json(result);
});
adminRoutes.get("/mobile-commands", async (c) => c.json(await getCommands()));
adminRoutes.get("/task-assignments", async (c) => c.json(await getTaskAssignments()));
adminRoutes.post("/task-assignments", async (c) => {
  const parsed = createTaskAssignmentSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  return c.json(await createTaskAssignmentFromAdmin(parsed.data), 201);
});
adminRoutes.get("/agent-versions", async (c) => c.json(await getAgentVersions()));
adminRoutes.post("/agent-versions", async (c) => {
  const parsed = createAgentVersionSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  return c.json(await publishAgentVersion(parsed.data), 201);
});
adminRoutes.post("/mobile-commands", async (c) => {
  const parsed = createMobileCommandSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  return c.json(await createCommand(parsed.data), 201);
});

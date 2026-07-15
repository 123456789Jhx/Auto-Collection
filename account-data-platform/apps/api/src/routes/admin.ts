import {
  createAgentVersionSchema,
  createCommerceCardExecutionApprovalSchema,
  createMobileCommandSchema,
  createTaskAssignmentCommandSchema,
  createTaskAssignmentSchema,
  estimateCommerceCardWorkflowDuration,
  featureRolloutControlUpdateSchema,
  featureRolloutKeySchema,
  resolveCommerceCardCommentActionSchema,
  revokeCommerceCardExecutionApprovalSchema,
  updateDeviceSchema,
  updateDeviceTaskConfigSchema,
  updateTaskSchema
} from "@pkg/types";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { validationError } from "../lib/validation";
import { adminAuth, type AdminVariables } from "../middleware/admin-auth";
import { loginAdmin } from "../services/auth.service";
import { createCommand, getCommands } from "../services/command.service";
import { clearDeviceToken, deleteDeviceRecord, getDeviceDailyProgress, getDeviceProgressHistory, getDeviceTaskConfig, getDevices, getLiveCommentActions, getLiveCommentDeviceSummary, getLogDates, getLogDeviceSummary, getLogFileDates, getLogFileDetail, getLogFiles, getLogs, getOverview, getRecordDates, getRecordDeviceSummary, getRecords, getTasks, rotateDeviceToken, updateDevice, updateDeviceTaskConfig, updateTaskConfig } from "../services/admin.service";
import { getAgentVersions, publishAgentVersion } from "../services/agent-version.service";
import { createTaskAssignmentCommandFromAdmin, createTaskAssignmentFromAdmin, getTaskAssignments } from "../services/task-orchestrator.service";
import { deleteLiveTarget, getCommerceCardFeaturePreviewData, listLiveTargetDetails, replaceLiveTargetDeviceBindings, upsertLiveTarget, upsertLiveTargetFeatureConfig } from "../repositories/live-target.repository";
import { FeatureAllowlistDeviceNotFoundError, FeatureControlRevisionConflictError } from "../repositories/feature-rollout.repository";
import { FeatureActivationNotReadyError, FeatureRolloutRejectedError, getFeatureRolloutControl, listFeatureRolloutControls, updateFeatureRolloutControl } from "../services/feature-rollout-control.service";
import { ConfigRevisionConflictError, ConfigRevisionRequiredError, liveTargetFeatureConfigSchema, liveTargetFeatureTypeSchema, liveTargetPayloadSchema } from "../services/live-target-config.service";
import { AssignmentRuntimeError } from "../repositories/task-assignment.repository";
import { createExecutionApproval, getExecutionApprovals, revokeExecutionApproval } from "../services/commerce-card-execution-approval.service";
import { resolveCommentAction } from "../services/commerce-card-comment-action.service";
import { getTaskAssignmentEvents } from "../services/task-assignment-runtime.service";

const adminLoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

const liveTargetDeviceBindingsSchema = z.object({
  targetId: z.string().uuid(),
  featureType: liveTargetFeatureTypeSchema,
  deviceCodes: z.array(z.string().trim().min(1).max(64)).max(200).default([]),
  defaultEnabled: z.boolean().default(false),
  expectedRevision: z.number().int().positive().optional()
});

function liveTargetMutationError(c: Context<{ Variables: AdminVariables }>, error: unknown) {
  if (error instanceof ConfigRevisionConflictError || error instanceof ConfigRevisionRequiredError) {
    return c.json({
      error: {
        code: error.message,
        message: error instanceof ConfigRevisionRequiredError ? "保存前必须重新加载当前配置版本" : "配置已被其他管理员修改，请重新加载",
        details: { currentRevision: error.currentRevision }
      }
    }, 409);
  }
  throw error;
}

function assignmentRuntimeErrorResponse(c: Context<{ Variables: AdminVariables }>, error: unknown) {
  if (!(error instanceof AssignmentRuntimeError)) {
    throw error;
  }
  const notFound = ["ASSIGNMENT_NOT_FOUND", "COMMENT_ACTION_NOT_FOUND", "EXECUTION_APPROVAL_NOT_FOUND"].includes(error.message);
  return c.json({
    error: {
      code: error.message,
      message: error.message,
      category: "assignment_runtime",
      stage: "admin_control",
      retryable: false,
      recoveryAction: notFound ? "refresh_list" : "refresh_assignment_state",
      details: error.details
    }
  }, notFound ? 404 : 409);
}

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
adminRoutes.get("/feature-rollout-controls", async (c) => c.json(await listFeatureRolloutControls()));
adminRoutes.patch("/feature-rollout-controls/:key", async (c) => {
  const featureKey = featureRolloutKeySchema.safeParse(c.req.param("key"));
  const payload = featureRolloutControlUpdateSchema.safeParse(await c.req.json());
  if (!featureKey.success) {
    return validationError(c, featureKey.error);
  }
  if (!payload.success) {
    return validationError(c, payload.error);
  }
  try {
    const result = await updateFeatureRolloutControl(featureKey.data, payload.data, c.get("admin").username);
    return c.json(result);
  } catch (error) {
    if (error instanceof FeatureControlRevisionConflictError) {
      return c.json({ error: { code: error.message, message: "运行门禁已被其他管理员修改，请重新加载", details: { currentRevision: error.currentRevision } } }, 409);
    }
    if (error instanceof FeatureAllowlistDeviceNotFoundError) {
      return c.json({ error: { code: error.message, message: "灰度名单包含不存在的设备", details: { deviceCodes: error.deviceCodes } } }, 400);
    }
    if (error instanceof FeatureActivationNotReadyError) {
      return c.json({ error: { code: error.message, message: "当前仍处于配置准备阶段，不能开启运行门禁", details: { featureKey: error.featureKey } } }, 409);
    }
    throw error;
  }
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
  try {
    const result = await upsertLiveTarget(parsed.data);
    if (!result) {
      return c.json({ error: { code: "LIVE_TARGET_NOT_FOUND", message: "直播目标不存在", details: {} } }, 404);
    }
    return c.json(result);
  } catch (error) {
    return liveTargetMutationError(c, error);
  }
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
  try {
    const result = await upsertLiveTargetFeatureConfig(c.req.param("id"), parsed.data);
    if (!result) {
      return c.json({ error: { code: "LIVE_TARGET_NOT_FOUND", message: "直播目标不存在", details: {} } }, 404);
    }
    return c.json(result);
  } catch (error) {
    return liveTargetMutationError(c, error);
  }
});
adminRoutes.get("/live-targets/:id/feature-configs/commerce-card/preview", async (c) => {
  const [preview, rollout] = await Promise.all([
    getCommerceCardFeaturePreviewData(c.req.param("id")),
    getFeatureRolloutControl("commerce_card_workflow_v2")
  ]);
  if (!preview) {
    return c.json({ error: { code: "COMMERCE_CARD_FEATURE_NOT_FOUND", message: "商品卡养号配置不存在", details: {} } }, 404);
  }
  if (!rollout) {
    return c.json({ error: { code: "FEATURE_ROLLOUT_CONTROL_NOT_FOUND", message: "商品卡养号运行门禁尚未初始化", details: {} } }, 503);
  }
  return c.json({
    source: "target_center_v2" as const,
    workflowVersion: 2 as const,
    revision: preview.revision,
    configHash: preview.configHash,
    duration: estimateCommerceCardWorkflowDuration(preview.runtimeConfig),
    rollout,
    manualExecutionApproved: false as const,
    payload: preview.payload
  });
});
adminRoutes.post("/live-target-device-bindings", async (c) => {
  const parsed = liveTargetDeviceBindingsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  try {
    const result = await replaceLiveTargetDeviceBindings(parsed.data);
    if (!result) {
      return c.json({ error: { code: "LIVE_TARGET_NOT_FOUND", message: "直播目标不存在", details: {} } }, 404);
    }
    return c.json(result);
  } catch (error) {
    return liveTargetMutationError(c, error);
  }
});
adminRoutes.get("/mobile-commands", async (c) => c.json(await getCommands()));
adminRoutes.get("/task-assignments", async (c) => c.json(await getTaskAssignments()));
adminRoutes.get("/task-assignments/:id/events", async (c) => {
  try {
    return c.json(await getTaskAssignmentEvents(c.req.param("id")));
  } catch (error) {
    return assignmentRuntimeErrorResponse(c, error);
  }
});
adminRoutes.post("/task-assignments/:id/commands", async (c) => {
  const parsed = createTaskAssignmentCommandSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  try {
    return c.json(await createTaskAssignmentCommandFromAdmin(c.req.param("id"), parsed.data), 201);
  } catch (error) {
    if (error instanceof FeatureRolloutRejectedError) {
      return c.json({ error: { code: error.message, message: "当前设备不满足商品卡养号恢复条件", details: { reasons: error.reasons } } }, 409);
    }
    return assignmentRuntimeErrorResponse(c, error);
  }
});
adminRoutes.post("/task-assignments", async (c) => {
  const parsed = createTaskAssignmentSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  try {
    return c.json(await createTaskAssignmentFromAdmin(parsed.data), 201);
  } catch (error) {
    if (error instanceof FeatureRolloutRejectedError) {
      return c.json({ error: { code: error.message, message: "当前设备不满足商品卡养号启动条件", details: { reasons: error.reasons } } }, 409);
    }
    return assignmentRuntimeErrorResponse(c, error);
  }
});
adminRoutes.get("/commerce-card-execution-approvals", async (c) => c.json(await getExecutionApprovals()));
adminRoutes.post("/commerce-card-execution-approvals", async (c) => {
  const parsed = createCommerceCardExecutionApprovalSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  try {
    return c.json(await createExecutionApproval(parsed.data, c.get("admin").username), 201);
  } catch (error) {
    return assignmentRuntimeErrorResponse(c, error);
  }
});
adminRoutes.post("/commerce-card-execution-approvals/:id/revoke", async (c) => {
  const parsed = revokeCommerceCardExecutionApprovalSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  try {
    return c.json(await revokeExecutionApproval(c.req.param("id"), parsed.data, c.get("admin").username));
  } catch (error) {
    return assignmentRuntimeErrorResponse(c, error);
  }
});
adminRoutes.post("/live-comment-actions/:id/resolve", async (c) => {
  const parsed = resolveCommerceCardCommentActionSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  try {
    return c.json(await resolveCommentAction(c.req.param("id"), parsed.data, c.get("admin").username));
  } catch (error) {
    return assignmentRuntimeErrorResponse(c, error);
  }
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
  try {
    return c.json(await createCommand(parsed.data), 201);
  } catch (error) {
    return assignmentRuntimeErrorResponse(c, error);
  }
});

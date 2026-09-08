import {
  createAgentVersionSchema,
  accountWarmupVocabularyQuerySchema,
  accountWarmupVocabularySaveSchema,
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
  updateBaseConnectivityThresholdSchema,
  updateDeviceTaskConfigSchema,
  updateTaskSchema
} from "@pkg/types";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { validationError } from "../lib/validation";
import { adminAuth, type AdminVariables } from "../middleware/admin-auth";
import { loginAdmin } from "../services/auth.service";
import { createCommand, getCommands } from "../services/command.service";
import { clearDeviceToken, deleteDeviceRecord, getDeviceDailyProgress, getDeviceProgressHistory, getDeviceTaskConfig, getDevices, getLiveCommentActions, getLiveCommentDeviceSummary, getLogDates, getLogDeviceSummary, getLogFileDates, getLogFileDetail, getLogFiles, getLogs, getOverview, getRecordDates, getRecordDeviceSummary, getRecords, getTasks, rotateDeviceToken, updateBaseConnectivityThreshold, updateDevice, updateDeviceTaskConfig, updateTaskConfig } from "../services/admin.service";
import { getAgentVersions, publishAgentVersion } from "../services/agent-version.service";
import { createTaskAssignmentCommandFromAdmin, createTaskAssignmentFromAdmin, getTaskAssignments } from "../services/task-orchestrator.service";
import { deleteLiveTarget, getCommerceCardFeaturePreviewData, listLiveTargetDetails, replaceLiveTargetDeviceBindings, upsertLiveTarget, upsertLiveTargetFeatureConfig } from "../repositories/live-target.repository";
import { FeatureAllowlistDeviceNotFoundError, FeatureControlRevisionConflictError } from "../repositories/feature-rollout.repository";
import { FeatureActivationNotReadyError, FeatureRolloutRejectedError, getFeatureRolloutControl, listFeatureRolloutControls, updateFeatureRolloutControl } from "../services/feature-rollout-control.service";
import { ConfigRevisionConflictError, ConfigRevisionRequiredError, liveTargetFeatureConfigSchema, liveTargetFeatureTypeSchema, liveTargetPayloadSchema } from "../services/live-target-config.service";
import { publishTaskRoutes } from "./publish-tasks";
import { publishScheduleRoutes } from "./publish-schedules";
import { AssignmentRuntimeError } from "../repositories/task-assignment.repository";
import { ExitAgentAppConflictError } from "../repositories/command.repository";
import { createExecutionApproval, getExecutionApprovals, revokeExecutionApproval } from "../services/commerce-card-execution-approval.service";
import { resolveCommentAction } from "../services/commerce-card-comment-action.service";
import { getTaskAssignmentEvents } from "../services/task-assignment-runtime.service";
import { listRemoteScriptDefinitions } from "../services/remote-script-registry";
import { remoteScriptConfigRoutes } from "./remote-scripts";
import { publishInterfaceBindingRoutes } from "./publish-interface-bindings";
import { publishInterfaceRunRoutes } from "./publish-interface-runs";
import { publishInterfaceMonitorRoutes } from "./publish-interface-monitor";
import { singleInterfacePublishRoutes } from "./single-interface-publish";
import { guardLegacyMobileCommand, guardLegacyTaskAssignment } from "../services/legacy-freeze";
import { deleteAccountWarmupVocabulary, getAccountWarmupVocabulary, saveAccountWarmupVocabulary } from "../services/account-warmup-vocabulary.service";
import { deviceRecoveryRoutes } from "../features/device-recovery/device-recovery.runtime";
import { confirmLiveCommentCandidates, getPendingLiveCommentCandidates } from "../services/live-comment-candidate.service";
import { findLiveRoomCapture, findLiveRoomProfile, listLiveRoomCaptures } from "../repositories/live-room-capture.repository";
import { startLiveRoomProfileGeneration } from "../services/live-room-profile.service";

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

const liveCommentCandidateConfirmSchema = z.object({
  batchId: z.string().uuid(),
  candidateIds: z.array(z.string().uuid()).max(200),
  clean: z.boolean().default(true)
}).strict();

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

function profileMarkdown(capture: NonNullable<Awaited<ReturnType<typeof findLiveRoomCapture>>>, profile: NonNullable<Awaited<ReturnType<typeof findLiveRoomProfile>>>) {
  const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  const evidence = Array.isArray(profile.evidenceComments) ? profile.evidenceComments : [];
  return [
    `# ${capture.accountName || capture.roomKey} 用户画像`,
    "",
    `- 直播间键：${capture.roomKey}`,
    `- 批次：${capture.batchId}`,
    `- 设备：${capture.deviceId}`,
    `- 模型：${profile.model || "gpt-5.5"}`,
    `- 置信度：${profile.confidence || "未提供"}`,
    "",
    "## 画像摘要",
    profile.summary || "暂无摘要",
    "",
    "## 主要人群特征",
    ...list(profile.audienceFeatures).map((item) => `- ${item}`),
    "",
    "## 兴趣 / 需求倾向",
    ...list(profile.interestNeeds).map((item) => `- ${item}`),
    "",
    "## 消费 / 互动特征",
    ...list(profile.interactionTraits).map((item) => `- ${item}`),
    "",
    "## 证据评论样本",
    ...evidence.map((item) => {
      const row = item as Record<string, unknown>;
      return `- “${String(row.text || "") }”${row.reason ? `：${String(row.reason)}` : ""}${row.confidence !== undefined ? `（置信度：${String(row.confidence)}）` : ""}`;
    }),
    "",
    "## 置信度说明",
    profile.confidenceExplanation || "暂无说明",
    ""
  ].join("\n");
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
adminRoutes.route("/device-recovery", deviceRecoveryRoutes.admin);

adminRoutes.get("/auth/me", async (c) => c.json({ user: c.get("admin") }));
adminRoutes.get("/remote-scripts/definitions", async (c) => c.json(await listRemoteScriptDefinitions()));
adminRoutes.route("/remote-scripts", remoteScriptConfigRoutes);
adminRoutes.route("/publish-tasks", publishTaskRoutes);
adminRoutes.route("/publish-schedules", publishScheduleRoutes);
adminRoutes.route("/interface-publish/bindings", publishInterfaceBindingRoutes);
adminRoutes.route("/interface-publish/runs", publishInterfaceRunRoutes);
adminRoutes.route("/interface-publish/monitor", publishInterfaceMonitorRoutes);
adminRoutes.route("/single-interface-publish", singleInterfacePublishRoutes);
adminRoutes.get("/account-warmup/vocabulary", async (c) => {
  const parsed = accountWarmupVocabularyQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  return c.json(await getAccountWarmupVocabulary(parsed.data));
});
adminRoutes.get("/live-comment-candidates", async (c) => {
  const batchId = z.string().uuid().safeParse(c.req.query("batchId"));
  if (!batchId.success) return validationError(c, batchId.error);
  return c.json(await getPendingLiveCommentCandidates(batchId.data));
});
adminRoutes.post("/live-comment-candidates/confirm", async (c) => {
  const parsed = liveCommentCandidateConfirmSchema.safeParse(await c.req.json());
  if (!parsed.success) return validationError(c, parsed.error);
  return c.json(await confirmLiveCommentCandidates(parsed.data.batchId, parsed.data.candidateIds, { clean: parsed.data.clean }));
});
adminRoutes.get("/live-room-captures", async (c) => {
  const parsed = z.object({ batchId: z.string().uuid(), deviceId: z.string().uuid() }).safeParse(c.req.query());
  if (!parsed.success) return validationError(c, parsed.error);
  return c.json(await listLiveRoomCaptures(parsed.data.batchId, parsed.data.deviceId));
});
adminRoutes.get("/live-room-captures/:captureId/profile", async (c) => {
  const captureId = z.string().uuid().safeParse(c.req.param("captureId"));
  if (!captureId.success) return validationError(c, captureId.error);
  return c.json(await findLiveRoomProfile(captureId.data));
});
adminRoutes.post("/live-room-captures/:captureId/profile", async (c) => {
  const captureId = z.string().uuid().safeParse(c.req.param("captureId"));
  if (!captureId.success) return validationError(c, captureId.error);
  const capture = await findLiveRoomCapture(captureId.data);
  if (!capture) return c.json({ error: { code: "LIVE_ROOM_CAPTURE_NOT_FOUND", message: "直播间抓取记录不存在", details: {} } }, 404);
  if (!capture.captureCompleted) return c.json({ error: { code: "LIVE_ROOM_CAPTURE_NOT_COMPLETED", message: "抓取尚未完成，暂不能解析画像", details: {} } }, 409);
  const profile = await startLiveRoomProfileGeneration(capture);
  return c.json(profile);
});
adminRoutes.get("/live-room-captures/:captureId/profile/markdown", async (c) => {
  const captureId = z.string().uuid().safeParse(c.req.param("captureId"));
  if (!captureId.success) return validationError(c, captureId.error);
  const capture = await findLiveRoomCapture(captureId.data);
  const profile = await findLiveRoomProfile(captureId.data);
  if (!capture || !profile) return c.json({ error: { code: "LIVE_ROOM_PROFILE_NOT_FOUND", message: "用户画像不存在", details: {} } }, 404);
  if (profile.status !== "SUCCEEDED") return c.json({ error: { code: "LIVE_ROOM_PROFILE_NOT_READY", message: "用户画像尚未解析完成", details: {} } }, 409);
  const markdown = profileMarkdown(capture, profile);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(capture.roomKey)}-用户画像.md"`
    }
  });
});
adminRoutes.post("/account-warmup/vocabulary", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON request body", details: {} } }, 400);
  }
  const parsed = accountWarmupVocabularySaveSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  return c.json(await saveAccountWarmupVocabulary(parsed.data));
});
adminRoutes.delete("/account-warmup/vocabulary/:id", async (c) => {
  const parsed = z.string().uuid().safeParse(c.req.param("id"));
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  const result = await deleteAccountWarmupVocabulary(parsed.data);
  if (!result) {
    return c.json({
      error: {
        code: "ACCOUNT_WARMUP_VOCABULARY_NOT_FOUND",
        message: "Account warmup vocabulary entry was not found",
        details: {}
      }
    }, 404);
  }
  return c.json(result);
});
adminRoutes.get("/overview", async (c) => c.json(await getOverview()));
adminRoutes.get("/devices", async (c) => c.json(await getDevices()));
adminRoutes.patch("/devices/:deviceCode", async (c) => {
  const parsed = updateDeviceSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  try {
    return c.json(await updateDevice(c.req.param("deviceCode"), parsed.data));
  } catch (error) {
    if (String(error instanceof Error ? error.message : error) === "PUBLISH_ACCOUNT_BINDING_CONFLICT") {
      return c.json({ error: { code: "PUBLISH_ACCOUNT_BINDING_CONFLICT", message: "该平台账号已绑定其他设备", details: {} } }, 409);
    }
    throw error;
  }
});
adminRoutes.patch("/devices/:deviceCode/base-connectivity", async (c) => {
  const parsed = updateBaseConnectivityThresholdSchema.safeParse(await c.req.json());
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    return c.json(await updateBaseConnectivityThreshold(c.req.param("deviceCode"), parsed.data));
  } catch (error) {
    if (String(error instanceof Error ? error.message : error) === "DEVICE_NOT_FOUND") {
      return c.json({ error: { code: "DEVICE_NOT_FOUND", message: "Device was not found", details: {} } }, 404);
    }
    throw error;
  }
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
adminRoutes.get("/mobile-commands", async (c) => {
  const batchId = c.req.query("batchId")?.trim() || undefined;
  const featureKey = c.req.query("featureKey")?.trim() || undefined;
  if (batchId && !z.string().uuid().safeParse(batchId).success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "batchId 必须是有效 UUID", details: {} } }, 400);
  }
  if (featureKey && featureKey.length > 64) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "featureKey 过长", details: {} } }, 400);
  }
  return c.json(await getCommands({ batchId, featureKey }));
});
adminRoutes.get("/task-assignments", async (c) => c.json(await getTaskAssignments()));
adminRoutes.get("/task-assignments/:id/events", async (c) => {
  try {
    return c.json(await getTaskAssignmentEvents(c.req.param("id")));
  } catch (error) {
    return assignmentRuntimeErrorResponse(c, error);
  }
});
adminRoutes.post("/task-assignments/:id/commands", async (c) => {
  const frozen = guardLegacyTaskAssignment(c);
  if (frozen) return frozen;
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
  const frozen = guardLegacyTaskAssignment(c);
  if (frozen) return frozen;
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
  const body = await c.req.json();
  const frozen = guardLegacyMobileCommand(c, body);
  if (frozen) return frozen;
  const parsed = createMobileCommandSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(c, parsed.error);
  }
  try {
    return c.json(await createCommand(parsed.data), 201);
  } catch (error) {
    if (error instanceof ExitAgentAppConflictError) {
      return c.json({
        error: {
          code: error.message,
          message: "An active EXIT_AGENT_APP command conflicts with this request",
          details: error.details
        }
      }, 409);
    }
    return assignmentRuntimeErrorResponse(c, error);
  }
});

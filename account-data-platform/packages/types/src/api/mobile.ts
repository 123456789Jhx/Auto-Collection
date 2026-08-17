import { z } from "zod";
import {
  commerceCardAgentCapabilitiesSchema,
  commerceCardEffectiveWorkflowSchema,
  mobileLiveTargetConfigSchema
} from "../domain/commerce-card-workflow";
import { deviceStatusSchema, runtimeLogLevelSchema, sceneTypeSchema } from "../domain/common";

export const mobileTaskConfigSchema = z.object({
  taskId: z.string(),
  templateCode: z.string().optional(),
  deviceCode: z.string().optional(),
  platform: z.string(),
  mode: z.enum(["search", "feed"]),
  searchKeywords: z.array(z.string()),
  matchKeywords: z.array(z.string()),
  videoMinutesMin: z.number().int(),
  videoMinutesMax: z.number().int(),
  liveMinutesMin: z.number().int(),
  liveMinutesMax: z.number().int(),
  autoStart: z.boolean(),
  collectComments: z.boolean(),
  commentLimit: z.number().int(),
  heartbeatMinutes: z.number().int(),
  liveCommentRole: z.enum(["none", "followed", "follower"]).optional(),
  liveCommentGroup: z.enum(["A", "B", "C"]).nullable().optional(),
  liveCommentMode: z.enum(["off", "target_follow", "agri_chatbot"]).optional(),
  accountProfile: z.record(z.unknown()).nullable().optional(),
  liveCommentBotConfig: z.record(z.unknown()).nullable().optional(),
  followedAccounts: z
    .array(z.object({
      accountName: z.string().optional(),
      accountId: z.string().optional(),
      aliasNames: z.array(z.string()).optional()
    }))
    .optional(),
  liveCommentConfig: z.record(z.unknown()).nullable().optional(),
  commerceCardLiveComment: z.record(z.unknown()).nullable().optional(),
  p3ExtensionsConfig: z.record(z.unknown()).nullable().optional(),
  liveTargets: z.array(mobileLiveTargetConfigSchema).max(50).optional(),
  effectiveWorkflow: commerceCardEffectiveWorkflowSchema.nullable().optional()
});

export const mobileCollectionRecordSchema = z.object({
  taskId: z.string(),
  deviceId: z.string(),
  platform: z.string(),
  sceneType: sceneTypeSchema,
  keyword: z.string().optional(),
  matchedKeywords: z.array(z.string()).optional(),
  authorName: z.string().optional(),
  titleText: z.string().optional(),
  subtitleText: z.string().optional(),
  metricsText: z.string().optional(),
  hotComments: z.array(z.string()).optional(),
  screenText: z.string().optional(),
  rawPayload: z.record(z.unknown()).optional(),
  capturedAt: z.string().optional()
});

export const mobileHeartbeatSchema = z.object({
  taskId: z.string(),
  deviceId: z.string(),
  appVersion: z.string().optional(),
  status: deviceStatusSchema,
  sceneType: z.preprocess((value) => value === "" || value === null ? undefined : value, sceneTypeSchema.optional()),
  elapsedMinutes: z.number().int().nullable().optional(),
  remainingMinutes: z.number().int().nullable().optional(),
  viewedCount: z.number().int().optional(),
  liveViewedCount: z.number().int().optional(),
  liveRoomEnteredCount: z.number().int().optional(),
  liveCandidateCount: z.number().int().optional(),
  liveRejectedCount: z.number().int().optional(),
  capturedCount: z.number().int().optional(),
  lastMessage: z.string().optional(),
  douyinAccountName: z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().trim().min(1).max(100).optional()),
  capabilities: commerceCardAgentCapabilitiesSchema.optional(),
  expectedEndAt: z.string().nullable().optional(),
  rawPayload: z.record(z.unknown()).optional(),
  reportedAt: z.string().optional()
});

export const mobileBaseHeartbeatSchema = z.object({
  deviceId: z.string(),
  screenState: z.enum(["locked", "unlocked", "unknown"]).default("unknown"),
  agentState: z.enum(["running", "stopped"]),
  reportedAt: z.string().optional()
});

export const mobileBaseConnectivityHeartbeatSchema = z.object({
  deviceId: z.string().trim().min(1).max(64),
  screenState: z.enum(["locked", "unlocked", "unknown"]).default("unknown"),
  appUiState: z.enum(["foreground", "background", "not_running", "unknown"]).default("unknown")
}).strict();

export const mobileAgentUpdateEventSchema = z.object({
  deviceId: z.string(),
  fromVersion: z.string().optional(),
  toVersion: z.string().optional(),
  eventType: z.enum(["CHECKED", "DOWNLOADED", "VERIFIED", "APPLIED", "FAILED", "ROLLBACK"]),
  message: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  reportedAt: z.string().optional()
});

export const mobileRuntimeLogSchema = z.object({
  taskId: z.string().optional(),
  deviceId: z.string(),
  level: runtimeLogLevelSchema,
  message: z.string(),
  context: z.record(z.unknown()).optional(),
  stopReason: z.string().nullable().optional(),
  reportedAt: z.string().optional()
});

export const mobileLiveCommentActionSchema = z.object({
  taskId: z.string().optional(),
  deviceId: z.string(),
  platform: z.string().default("douyin"),
  triggerEventId: z.string().optional(),
  roomName: z.string().optional(),
  leaderAccountName: z.string().optional(),
  triggerText: z.string().optional(),
  matchedKeywords: z.array(z.string()).optional(),
  replyText: z.string().min(1),
  plannedDelayMs: z.number().int().nonnegative().optional(),
  status: z.enum(["planned", "submitting", "submitted", "sent", "unknown", "failed", "skipped"]),
  skipReason: z.string().optional(),
  failureReason: z.string().optional(),
  rawPayload: z.record(z.unknown()).optional(),
  plannedAt: z.string().optional(),
  sentAt: z.string().optional(),
  reportedAt: z.string().optional()
});

export const mobileLogFileSchema = z.object({
  taskId: z.string().optional(),
  deviceId: z.string(),
  logDate: z.string().min(10).max(10),
  fileName: z.string().min(1).max(200),
  content: z.string(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  uploadedAt: z.string().optional()
});

export const mobileCommandAckSchema = z.object({
  deviceId: z.string(),
  status: z.enum(["FETCHED", "CLAIMED", "RUNNING", "DONE", "FAILED", "IGNORED", "TIMED_OUT"]),
  result: z.record(z.unknown()).optional()
});

export const exitAgentAppStageSchema = z.object({
  name: z.enum(["STOP_AGENT", "REMOVE_APP_TASK", "LOCK_SCREEN"]),
  status: z.enum(["SUCCESS", "SKIPPED", "FAILED"]),
  reason: z.string().trim().min(1).optional()
}).strict();

const stopAgentExitStageSchema = exitAgentAppStageSchema.extend({
  name: z.literal("STOP_AGENT")
});

const removeAppTaskExitStageSchema = exitAgentAppStageSchema.extend({
  name: z.literal("REMOVE_APP_TASK")
});

const lockScreenExitStageSchema = exitAgentAppStageSchema.extend({
  name: z.literal("LOCK_SCREEN")
});

export const exitAgentAppResultSchema = z.object({
  commandType: z.literal("EXIT_AGENT_APP"),
  result: z.enum(["DONE", "PARTIAL", "FAILED"]),
  stages: z.tuple([
    stopAgentExitStageSchema,
    removeAppTaskExitStageSchema,
    lockScreenExitStageSchema
  ])
}).strict().superRefine((value, context) => {
  const [stopAgent, removeAppTask, lockScreen] = value.stages;
  const stopOrRemoveFailed = stopAgent.status === "FAILED" || removeAppTask.status === "FAILED";
  const lockFailed = lockScreen.status === "FAILED";
  if (value.result === "DONE" && (stopOrRemoveFailed || lockFailed)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["result"],
      message: "exit_done_requires_all_stages_non_failed"
    });
  }
  if (value.result === "PARTIAL" && (stopOrRemoveFailed || !lockFailed)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["result"],
      message: "exit_partial_requires_only_lock_screen_failure"
    });
  }
  if (value.result === "FAILED" && !stopOrRemoveFailed) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["result"],
      message: "exit_failed_requires_stop_or_remove_failure"
    });
  }
});

export const mobileBaseCommandAckSchema = z.object({
  deviceId: z.string().trim().min(1).max(64),
  claimToken: z.string().uuid(),
  status: z.enum(["DONE", "FAILED"]),
  result: z.record(z.unknown()).optional()
}).strict().superRefine((value, context) => {
  if (!value.result || !("commandType" in value.result || "result" in value.result || "stages" in value.result)) return;
  const parsed = exitAgentAppResultSchema.safeParse(value.result);
  if (parsed.success) {
    const expectedStatus = parsed.data.result === "FAILED" ? "FAILED" : "DONE";
    if (value.status !== expectedStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "exit_ack_transport_status_mismatch"
      });
    }
    return;
  }
  parsed.error.issues.forEach((issue) => context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["result", ...issue.path],
    message: issue.message
  }));
});

export type MobileTaskConfig = z.infer<typeof mobileTaskConfigSchema>;
export type MobileCollectionRecordPayload = z.infer<typeof mobileCollectionRecordSchema>;
export type MobileHeartbeatPayload = z.infer<typeof mobileHeartbeatSchema>;
export type MobileBaseHeartbeatPayload = z.infer<typeof mobileBaseHeartbeatSchema>;
export type MobileBaseConnectivityHeartbeatPayload = z.infer<typeof mobileBaseConnectivityHeartbeatSchema>;
export type MobileRuntimeLogPayload = z.infer<typeof mobileRuntimeLogSchema>;
export type MobileLiveCommentActionPayload = z.infer<typeof mobileLiveCommentActionSchema>;
export type MobileLogFilePayload = z.infer<typeof mobileLogFileSchema>;
export type MobileCommandAckPayload = z.infer<typeof mobileCommandAckSchema>;
export type MobileBaseCommandAckPayload = z.infer<typeof mobileBaseCommandAckSchema>;
export type ExitAgentAppStage = z.infer<typeof exitAgentAppStageSchema>;
export type ExitAgentAppResult = z.infer<typeof exitAgentAppResultSchema>;
export type MobileAgentUpdateEventPayload = z.infer<typeof mobileAgentUpdateEventSchema>;

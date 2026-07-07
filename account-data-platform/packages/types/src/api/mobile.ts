import { z } from "zod";
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
  p3ExtensionsConfig: z.record(z.unknown()).nullable().optional()
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
  expectedEndAt: z.string().nullable().optional(),
  rawPayload: z.record(z.unknown()).optional(),
  reportedAt: z.string().optional()
});

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
  status: z.enum(["planned", "sent", "failed", "skipped"]),
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
  status: z.enum(["FETCHED", "DONE", "FAILED", "IGNORED"]),
  result: z.record(z.unknown()).optional()
});

export type MobileTaskConfig = z.infer<typeof mobileTaskConfigSchema>;
export type MobileCollectionRecordPayload = z.infer<typeof mobileCollectionRecordSchema>;
export type MobileHeartbeatPayload = z.infer<typeof mobileHeartbeatSchema>;
export type MobileRuntimeLogPayload = z.infer<typeof mobileRuntimeLogSchema>;
export type MobileLiveCommentActionPayload = z.infer<typeof mobileLiveCommentActionSchema>;
export type MobileLogFilePayload = z.infer<typeof mobileLogFileSchema>;
export type MobileCommandAckPayload = z.infer<typeof mobileCommandAckSchema>;
export type MobileAgentUpdateEventPayload = z.infer<typeof mobileAgentUpdateEventSchema>;

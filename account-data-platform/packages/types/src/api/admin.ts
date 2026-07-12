import { z } from "zod";

export const adminLoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

export type AdminLoginPayload = z.infer<typeof adminLoginSchema>;

export const createTaskSchema = z
  .object({
    taskCode: z.string().min(1),
    name: z.string().min(1),
    platform: z.string().default("douyin"),
    mode: z.enum(["search", "feed"]).default("search"),
    searchKeywords: z.array(z.string().min(1)).min(1),
    matchKeywords: z.array(z.string().min(1)).min(1),
    videoMinutesMin: z.number().int().min(120).default(120),
    videoMinutesMax: z.number().int().min(120).default(180),
    liveMinutesMin: z.number().int().min(60).default(60),
    liveMinutesMax: z.number().int().min(60).default(120),
    autoStart: z.boolean().default(false),
    collectComments: z.boolean().default(true),
    commentLimit: z.number().int().min(0).max(50).default(10),
    heartbeatMinutes: z.number().int().min(1).default(1)
  })
  .refine((data) => data.videoMinutesMax >= data.videoMinutesMin, {
    message: "videoMinutesMax must be greater than or equal to videoMinutesMin",
    path: ["videoMinutesMax"]
  })
  .refine((data) => data.liveMinutesMax >= data.liveMinutesMin, {
    message: "liveMinutesMax must be greater than or equal to liveMinutesMin",
    path: ["liveMinutesMax"]
  });

export type CreateTaskPayload = z.infer<typeof createTaskSchema>;

export const liveCommentConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    executeEnabled: z.boolean().optional(),
    manualExecutionApproved: z.boolean().optional(),
    groupName: z.enum(["A", "B", "C"]).optional(),
    leaderAccountNames: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    leaderAccountIds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    triggerKeywords: z.array(z.string().trim().min(1).max(30)).max(50).optional(),
    replyPools: z
      .object({
        A: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
        B: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
        C: z.array(z.string().trim().min(1).max(80)).max(30).optional()
      })
      .strict()
      .optional(),
    sendDelayMinMs: z.number().int().min(500).max(60000).optional(),
    sendDelayMaxMs: z.number().int().min(500).max(120000).optional(),
    perDeviceCooldownSeconds: z.number().int().min(10).max(3600).optional(),
    localCommentCacheSize: z.number().int().min(20).max(2000).optional(),
    maxConsecutiveSendFailures: z.number().int().min(1).max(10).optional(),
    perTaskMaxComments: z.number().int().min(1).max(500).optional(),
    lowConfidenceAction: z.enum(["log_only", "skip"]).optional()
  })
  .strict()
  .refine((data) => data.sendDelayMinMs === undefined || data.sendDelayMaxMs === undefined || data.sendDelayMaxMs >= data.sendDelayMinMs, {
    message: "sendDelayMaxMs must be greater than or equal to sendDelayMinMs",
    path: ["sendDelayMaxMs"]
  });

export type LiveCommentConfigPayload = z.infer<typeof liveCommentConfigSchema>;

export const liveCommentRoleSchema = z.enum(["none", "followed", "follower"]);
export const liveCommentGroupSchema = z.enum(["A", "B", "C"]);
export const liveCommentModeSchema = z.enum(["off", "target_follow", "agri_chatbot"]);

export const p3ExtensionsConfigSchema = z
  .object({
    liveLike: z
      .object({
        enabled: z.literal(false).optional(),
        manualExecutionApproved: z.literal(false).optional(),
        maxLikesPerLiveRoom: z.number().int().min(0).max(3).optional(),
        minIntervalSeconds: z.number().int().min(30).max(3600).optional(),
        requireManualApproval: z.literal(true).optional()
      })
      .strict()
      .optional(),
    authorizedFollow: z
      .object({
        enabled: z.literal(false).optional(),
        manualExecutionApproved: z.literal(false).optional(),
        requireEmployeeAuthorization: z.literal(true).optional(),
        targetAccountId: z.string().trim().max(100).optional(),
        targetAccountName: z.string().trim().max(100).optional(),
        independentTaskOnly: z.literal(true).optional()
      })
      .strict()
      .optional(),
    linkage: z
      .object({
        allowM1Input: z.literal(false).optional(),
        allowM2Input: z.literal(false).optional(),
        allowM3OutputToMaterialPool: z.literal(false).optional()
      })
      .strict()
      .optional(),
    commerceCardLiveComment: z
      .object({
        enabled: z.boolean().optional(),
        executeEnabled: z.boolean().optional(),
        manualExecutionApproved: z.boolean().optional(),
        searchKeywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
        matchKeywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
        liveSignals: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
        targetRoom: z
          .object({
            enabled: z.boolean().optional(),
            targetName: z.string().trim().max(200).optional(),
            anchorName: z.string().trim().max(100).optional(),
            roomName: z.string().trim().max(200).optional(),
            searchKeywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
            matchKeywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
            roomKeywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
            titleKeywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
            requiredKeywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
            forbiddenKeywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
            similarityThreshold: z.number().min(0.5).max(1).optional()
          })
          .strict()
          .optional(),
        scanMinutesPerRound: z.number().int().min(1).max(60).optional(),
        watchMinutesPerLive: z.number().int().min(0).max(120).optional(),
        maxRounds: z.number().int().min(1).max(20).optional(),
        maxCommentsPerRoom: z.number().int().min(0).max(5).optional(),
        commentPool: z.array(z.string().trim().min(1).max(80)).max(50).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export type P3ExtensionsConfigPayload = z.infer<typeof p3ExtensionsConfigSchema>;

export const updateTaskSchema = z
  .object({
    videoMinutesMin: z.number().int().min(120).optional(),
    videoMinutesMax: z.number().int().min(120).optional(),
    liveMinutesMin: z.number().int().min(60).optional(),
    liveMinutesMax: z.number().int().min(60).optional(),
    autoStart: z.boolean().optional(),
    collectComments: z.boolean().optional(),
    commentLimit: z.number().int().min(0).max(50).optional(),
    heartbeatMinutes: z.number().int().min(1).max(60).optional(),
    liveCommentConfig: liveCommentConfigSchema.optional(),
    liveCommentBotConfig: z.record(z.unknown()).nullable().optional(),
    p3ExtensionsConfig: p3ExtensionsConfigSchema.optional()
  })
  .refine((data) => data.videoMinutesMin === undefined || data.videoMinutesMax === undefined || data.videoMinutesMax >= data.videoMinutesMin, {
    message: "videoMinutesMax must be greater than or equal to videoMinutesMin",
    path: ["videoMinutesMax"]
  })
  .refine((data) => data.liveMinutesMin === undefined || data.liveMinutesMax === undefined || data.liveMinutesMax >= data.liveMinutesMin, {
    message: "liveMinutesMax must be greater than or equal to liveMinutesMin",
    path: ["liveMinutesMax"]
  });

export type UpdateTaskPayload = z.infer<typeof updateTaskSchema>;

export const updateDeviceTaskConfigSchema = z.intersection(
  updateTaskSchema,
  z.object({
    liveCommentRole: liveCommentRoleSchema.optional(),
    liveCommentGroup: liveCommentGroupSchema.nullable().optional(),
    followedAccountName: z.string().trim().max(100).nullable().optional(),
    followedAccountId: z.string().trim().max(100).nullable().optional(),
    followedAliases: z.array(z.string().trim().min(1).max(100)).max(20).nullable().optional(),
    liveCommentMode: liveCommentModeSchema.optional(),
    liveCommentBotConfig: z.record(z.unknown()).nullable().optional()
  })
);

export type UpdateDeviceTaskConfigPayload = z.infer<typeof updateDeviceTaskConfigSchema>;

export const updateDeviceSchema = z.object({
  deviceName: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  remark: z.string().trim().max(500).optional(),
  lastRegion: z.string().trim().max(100).optional(),
  accountProfile: z.record(z.unknown()).nullable().optional()
});

export type UpdateDevicePayload = z.infer<typeof updateDeviceSchema>;

export const createMobileCommandSchema = z.object({
  deviceId: z.string().min(1),
  taskId: z.string().optional(),
  assignmentId: z.string().uuid().optional(),
  commandSequence: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
  commandType: z.enum(["START", "PAUSE", "RESUME", "STOP", "REFRESH_CONFIG", "STATUS", "RESTART_APP", "RESTART_AGENT", "CHECK_UPDATE", "UPDATE_AGENT", "UPLOAD_LOG"]),
  payload: z.record(z.unknown()).optional(),
  expiresInSeconds: z.number().int().min(60).max(86400).default(3600)
});

export type CreateMobileCommandPayload = z.infer<typeof createMobileCommandSchema>;

export const taskAssignmentTypeSchema = z.enum(["video", "live", "live_comment", "commerce_card_live_comment"]);

export const createTaskAssignmentSchema = z
  .object({
    deviceId: z.string().min(1),
    taskType: taskAssignmentTypeSchema,
    commandType: z.enum(["START", "RESUME", "PAUSE", "STOP"]).default("START"),
    assignmentId: z.string().uuid().optional(),
    workflowVersion: z.union([z.literal(1), z.literal(2)]).default(1),
    targetId: z.string().uuid().optional(),
    executionApprovalId: z.string().uuid().nullable().optional(),
    expectedAccountId: z.string().trim().min(1).max(100).nullable().optional(),
    expectedAccountName: z.string().trim().min(1).max(100).nullable().optional(),
    expectedStateVersion: z.number().int().positive().optional(),
    commandIdempotencyKey: z.string().trim().min(16).max(160).optional(),
    reason: z.string().trim().max(200).optional(),
    priority: z.number().int().min(1).max(1000).default(100),
    source: z.string().trim().min(1).max(64).default("manual"),
    targetContext: z.string().trim().max(64).optional(),
    payload: z.record(z.unknown()).optional(),
    expiresInSeconds: z.number().int().min(60).max(86400).default(3600)
  })
  .superRefine((value, context) => {
    if (value.commandType === "START" && value.workflowVersion === 2) {
      if (value.taskType !== "commerce_card_live_comment") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "V2 只支持商品卡组合任务", path: ["taskType"] });
      }
    }
    if (value.commandType !== "START") {
      if (!value.assignmentId) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "控制命令必须指定原任务运行", path: ["assignmentId"] });
      }
      if (!value.expectedStateVersion) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "控制命令必须携带状态版本", path: ["expectedStateVersion"] });
      }
      if (!value.commandIdempotencyKey) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "控制命令必须携带幂等键", path: ["commandIdempotencyKey"] });
      }
    }
  });

export type CreateTaskAssignmentPayload = z.infer<typeof createTaskAssignmentSchema>;

export const createTaskAssignmentCommandSchema = z.object({
  commandType: z.enum(["PAUSE", "RESUME", "STOP"]),
  expectedStateVersion: z.number().int().positive(),
  commandIdempotencyKey: z.string().trim().min(16).max(160),
  reason: z.string().trim().max(200).optional(),
  priority: z.number().int().min(1).max(1000).default(100),
  expiresInSeconds: z.number().int().min(60).max(86400).default(3600),
  payload: z.record(z.unknown()).optional()
}).strict();

export type CreateTaskAssignmentCommandPayload = z.infer<typeof createTaskAssignmentCommandSchema>;

export const createAgentVersionSchema = z.object({
  version: z.string().min(1),
  channel: z.enum(["stable", "gray", "dev"]).default("stable"),
  minSupportedVersion: z.string().optional(),
  packageUrl: z.string().optional(),
  sha256: z.string().optional(),
  entryFile: z.string().default("main.js"),
  releaseNote: z.string().optional(),
  forceUpdate: z.boolean().default(false),
  status: z.enum(["DRAFT", "PUBLISHED", "REVOKED"]).default("PUBLISHED")
});

export type CreateAgentVersionPayload = z.infer<typeof createAgentVersionSchema>;

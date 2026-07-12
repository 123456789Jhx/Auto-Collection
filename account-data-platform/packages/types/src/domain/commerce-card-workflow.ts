import { z } from "zod";

export const commerceCardWorkflowStageSchema = z.enum([
  "product_nurture",
  "target_comment",
  "live_nurture"
]);

export type CommerceCardWorkflowStage = z.infer<typeof commerceCardWorkflowStageSchema>;

const commerceCardStageOrder: CommerceCardWorkflowStage[] = [
  "product_nurture",
  "target_comment",
  "live_nurture"
];

function normalizedTextList(options: { min?: number; max: number; maxLength: number }) {
  return z
    .array(z.string().trim().min(1).max(options.maxLength))
    .min(options.min ?? 0)
    .max(options.max)
    .transform((values) => Array.from(new Set(values)));
}

export const commerceCardWorkflowRuntimeConfigSchema = z
  .object({
    configVersion: z.literal(2).default(2),
    enabledStages: z
      .array(commerceCardWorkflowStageSchema)
      .min(1)
      .max(3)
      .default(["product_nurture"])
      .transform((values) => commerceCardStageOrder.filter((stage) => values.includes(stage))),
    executeEnabled: z.boolean().default(false),
    recommendationSignals: normalizedTextList({ min: 1, max: 20, maxLength: 50 }).default(["你可能还会喜欢"]),
    productCardDwellSeconds: z.number().int().min(60).max(180).default(120),
    productNurtureRoundMinutes: z.number().int().min(5).max(30).default(15),
    productNurtureMaxRounds: z.number().int().min(1).max(6).default(3),
    targetLiveMaxRoomsPerRefresh: z.number().int().min(20).max(30).default(25),
    targetCommentSearchMaxActiveMinutes: z.number().int().min(5).max(120).default(60),
    maxCommentsPerRoom: z.number().int().min(0).max(5).default(1),
    commentPool: normalizedTextList({ max: 50, maxLength: 80 }).default([]),
    liveNurtureKeywords: normalizedTextList({ max: 50, maxLength: 50 }).default([]),
    liveNurtureRefreshAfterRooms: z.number().int().min(5).max(20).default(10),
    liveNurtureWatchMinMinutes: z.number().int().min(1).max(30).default(10),
    liveNurtureWatchMaxMinutes: z.number().int().min(1).max(60).default(20),
    liveNurtureTotalMinMinutes: z.number().int().min(10).max(180).default(70),
    liveNurtureTotalMaxMinutes: z.number().int().min(10).max(240).default(100),
    taskMaxActiveMinutes: z.number().int().min(30).max(360).default(240)
  })
  .strict()
  .superRefine((value, context) => {
    const enabledStages = new Set(value.enabledStages);
    if (enabledStages.has("live_nurture") && !enabledStages.has("product_nurture")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "直播养号2必须同时启用商品卡养号",
        path: ["enabledStages"]
      });
    }
    if (enabledStages.has("target_comment") && value.maxCommentsPerRoom > 0 && value.commentPool.length < value.maxCommentsPerRoom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "评论内容数量不能少于单房评论上限",
        path: ["commentPool"]
      });
    }
    if (enabledStages.has("live_nurture") && value.liveNurtureKeywords.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "启用直播养号2时必须填写标题关键词",
        path: ["liveNurtureKeywords"]
      });
    }
    if (value.liveNurtureWatchMinMinutes > value.liveNurtureWatchMaxMinutes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "单房最短观看时长不能大于最长观看时长",
        path: ["liveNurtureWatchMaxMinutes"]
      });
    }
    if (value.liveNurtureTotalMinMinutes > value.liveNurtureTotalMaxMinutes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "累计观看下限不能大于累计观看上限",
        path: ["liveNurtureTotalMaxMinutes"]
      });
    }

    const duration = estimateCommerceCardWorkflowDuration(value);
    if (duration.maximumMinutes > value.taskMaxActiveMinutes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `最坏主动时长 ${duration.maximumMinutes} 分钟超过任务上限`,
        path: ["taskMaxActiveMinutes"]
      });
    }
  });

export type CommerceCardWorkflowRuntimeConfig = z.infer<typeof commerceCardWorkflowRuntimeConfigSchema>;

export const defaultCommerceCardWorkflowRuntimeConfig: CommerceCardWorkflowRuntimeConfig =
  commerceCardWorkflowRuntimeConfigSchema.parse({});

export type CommerceCardWorkflowDuration = {
  minimumMinutes: number;
  maximumMinutes: number;
  taskLimitMinutes: number;
  truncated: boolean;
};

export function estimateCommerceCardWorkflowDuration(
  config: Pick<
    CommerceCardWorkflowRuntimeConfig,
    | "enabledStages"
    | "productNurtureRoundMinutes"
    | "productNurtureMaxRounds"
    | "targetCommentSearchMaxActiveMinutes"
    | "liveNurtureTotalMinMinutes"
    | "liveNurtureTotalMaxMinutes"
    | "taskMaxActiveMinutes"
  >
): CommerceCardWorkflowDuration {
  const enabledStages = new Set(config.enabledStages);
  const productMinimum = enabledStages.has("product_nurture") ? config.productNurtureRoundMinutes : 0;
  const productMaximum = enabledStages.has("product_nurture")
    ? config.productNurtureRoundMinutes * config.productNurtureMaxRounds
    : 0;
  const targetSearchMaximum = enabledStages.has("target_comment") && !enabledStages.has("product_nurture")
    ? config.targetCommentSearchMaxActiveMinutes
    : 0;
  const liveMinimum = enabledStages.has("live_nurture") ? config.liveNurtureTotalMinMinutes : 0;
  const liveMaximum = enabledStages.has("live_nurture") ? config.liveNurtureTotalMaxMinutes : 0;
  const maximumMinutes = productMaximum + targetSearchMaximum + liveMaximum;

  return {
    minimumMinutes: productMinimum + liveMinimum,
    maximumMinutes,
    taskLimitMinutes: config.taskMaxActiveMinutes,
    truncated: maximumMinutes > config.taskMaxActiveMinutes
  };
}

export const liveTargetFeatureTypeSchema = z.enum(["live_comment", "commerce_card_live_comment"]);
export type LiveTargetFeatureType = z.infer<typeof liveTargetFeatureTypeSchema>;

export const mobileLiveTargetAliasSchema = z.object({
  aliasText: z.string().trim().min(1).max(200),
  aliasType: z.string().trim().min(1).max(32).default("room_name"),
  weight: z.number().int().min(0).max(1000).default(100),
  enabled: z.boolean().default(true)
});

export const mobileLiveTargetConfigSchema = z.object({
  targetId: z.string().uuid().optional(),
  targetCode: z.string().trim().min(1).max(64),
  targetName: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(32).default("douyin"),
  featureType: liveTargetFeatureTypeSchema,
  searchKeywords: normalizedTextList({ max: 50, maxLength: 100 }).default([]),
  requiredKeywords: normalizedTextList({ max: 50, maxLength: 100 }).default([]),
  forbiddenKeywords: normalizedTextList({ max: 50, maxLength: 100 }).default([]),
  productKeywords: normalizedTextList({ max: 50, maxLength: 100 }).default([]),
  liveSignals: normalizedTextList({ max: 50, maxLength: 100 }).default([]),
  runtimeConfig: z.record(z.unknown()).default({}),
  similarityThreshold: z.number().min(0.5).max(1).default(0.9),
  aliases: z.array(mobileLiveTargetAliasSchema).max(50).default([]),
  enabled: z.boolean().default(true),
  configSource: z.enum(["target_center_v1", "target_center_v2", "device_v1"]),
  workflowVersion: z.union([z.literal(1), z.literal(2)]),
  executionEligible: z.boolean(),
  executionBlockedReasons: z.array(z.string()).default([]),
  revision: z.number().int().positive().optional(),
  configHash: z.string().length(64).nullable().optional()
});

export type MobileLiveTargetConfig = z.infer<typeof mobileLiveTargetConfigSchema>;

export const commerceCardAgentCapabilitiesSchema = z
  .object({
    workflowVersion: z.number().int().min(1).max(2),
    checkpointVersion: z.number().int().min(1).max(2),
    pauseResume: z.boolean(),
    stableRoomKey: z.boolean(),
    idempotentComment: z.boolean(),
    shortLivedCommentPermit: z.boolean()
  })
  .strict();

export type CommerceCardAgentCapabilities = z.infer<typeof commerceCardAgentCapabilitiesSchema>;

export const featureRolloutKeySchema = z.enum([
  "commerce_card_workflow_v2",
  "commerce_card_real_comment"
]);

export type FeatureRolloutKey = z.infer<typeof featureRolloutKeySchema>;

export const commerceCardRequiredCapabilitySchema = z.enum([
  "workflow_v2",
  "checkpoint_v2",
  "pause_resume",
  "stable_room_key",
  "idempotent_comment",
  "short_lived_comment_permit"
]);

export const featureRolloutControlUpdateSchema = z
  .object({
    enabled: z.boolean(),
    expectedRevision: z.number().int().positive(),
    minAppVersion: z.string().trim().regex(/^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/).max(64).nullable(),
    requiredCapabilities: z.array(commerceCardRequiredCapabilitySchema).max(6).transform((values) => Array.from(new Set(values))),
    capabilityTtlSeconds: z.number().int().min(60).max(86400),
    deviceCodes: normalizedTextList({ max: 200, maxLength: 64 }),
    reason: z.string().trim().min(3).max(500)
  })
  .strict();

export type FeatureRolloutControlUpdate = z.infer<typeof featureRolloutControlUpdateSchema>;

export type FeatureRolloutControl = {
  featureKey: FeatureRolloutKey;
  enabled: boolean;
  revision: number;
  minAppVersion: string | null;
  requiredCapabilities: string[];
  capabilityTtlSeconds: number;
  deviceCodes: string[];
  activationReady: boolean;
  reason: string | null;
  updatedBy: string;
  updatedAt: string;
};

export type CommerceCardFeaturePreview = {
  source: "target_center_v2";
  workflowVersion: 2;
  revision: number;
  configHash: string;
  duration: CommerceCardWorkflowDuration;
  rollout: FeatureRolloutControl;
  manualExecutionApproved: false;
  payload: MobileLiveTargetConfig;
};

export const taskAssignmentStateSchema = z.enum([
  "PENDING",
  "DISPATCHED",
  "RUNNING",
  "PAUSING",
  "PAUSED",
  "RESUMING",
  "BLOCKED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED"
]);

export type TaskAssignmentState = z.infer<typeof taskAssignmentStateSchema>;

export const commerceCardExpectedAccountSchema = z
  .object({
    accountId: z.string().trim().min(1).max(100).nullable().default(null),
    accountName: z.string().trim().min(1).max(100).nullable().default(null)
  })
  .strict()
  .refine((value) => Boolean(value.accountId || value.accountName), {
    message: "必须指定预期抖音账号"
  });

export type CommerceCardExpectedAccount = z.infer<typeof commerceCardExpectedAccountSchema>;

export const commerceCardWorkflowSnapshotSchema = z
  .object({
    target: mobileLiveTargetConfigSchema,
    runtimeConfig: commerceCardWorkflowRuntimeConfigSchema,
    configSource: z.literal("target_center_v2")
  })
  .strict();

export type CommerceCardWorkflowSnapshot = z.infer<typeof commerceCardWorkflowSnapshotSchema>;

export const commerceCardEffectiveWorkflowSchema = z
  .object({
    assignmentId: z.string().uuid(),
    workflowVersion: z.literal(2),
    selectedTarget: mobileLiveTargetConfigSchema,
    expectedAccount: commerceCardExpectedAccountSchema,
    configRevision: z.number().int().positive(),
    configHash: z.string().regex(/^[0-9a-f]{64}$/),
    snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
    executionApprovalId: z.string().uuid().nullable(),
    expiresAt: z.string().datetime({ offset: true }),
    state: taskAssignmentStateSchema,
    stateVersion: z.number().int().positive(),
    lastEventSeq: z.number().int().nonnegative(),
    configSnapshot: commerceCardWorkflowSnapshotSchema
  })
  .strict();

export type CommerceCardEffectiveWorkflow = z.infer<typeof commerceCardEffectiveWorkflowSchema>;

export const commerceCardCheckpointV2Schema = z
  .object({
    checkpointVersion: z.literal(2),
    assignmentId: z.string().uuid(),
    configRevision: z.number().int().positive(),
    configHash: z.string().regex(/^[0-9a-f]{64}$/),
    snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
    taskType: z.literal("commerce_card_live_comment"),
    state: taskAssignmentStateSchema,
    stateVersion: z.number().int().positive(),
    stage: commerceCardWorkflowStageSchema,
    cycleIndex: z.number().int().nonnegative(),
    stateEnteredAt: z.string().datetime({ offset: true }),
    stageActiveElapsedMs: z.number().int().nonnegative(),
    taskActiveElapsedMs: z.number().int().nonnegative(),
    cardIndex: z.number().int().nonnegative(),
    browsedCardFingerprints: z.array(z.string().trim().min(1).max(160)).max(200),
    liveScanIndex: z.number().int().nonnegative(),
    liveMissCount: z.number().int().nonnegative(),
    liveRefreshCount: z.number().int().nonnegative(),
    roomKeyVersion: z.number().int().positive(),
    currentRoomKey: z.string().trim().max(200),
    targetFingerprint: z.string().trim().max(500),
    commentActionsByRoom: z.record(z.object({
      roomKey: z.string().trim().min(1).max(200),
      slot: z.number().int().nonnegative(),
      actionId: z.string().uuid(),
      commentHash: z.string().regex(/^[0-9a-f]{64}$/),
      actionState: z.enum(["planned", "submitting", "submitted", "sent", "unknown", "failed", "skipped"])
    }).strict()),
    plannedWatchMs: z.number().int().nonnegative(),
    completedWatchMs: z.number().int().nonnegative(),
    remainingWatchMs: z.number().int().nonnegative(),
    pendingSideEffect: z.object({
      actionId: z.string().uuid(),
      idempotencyKey: z.string().trim().min(1).max(220),
      slot: z.number().int().nonnegative(),
      commentHash: z.string().regex(/^[0-9a-f]{64}$/),
      permitExpiresAt: z.string().datetime({ offset: true }),
      lastConfirmedState: z.enum(["planned", "submitting", "submitted", "sent", "unknown", "failed", "skipped"])
    }).strict().nullable(),
    expectedAccountId: z.string().trim().max(100),
    pageSignature: z.string().trim().max(500),
    checkpointSequence: z.number().int().positive(),
    checkpointHash: z.string().regex(/^[0-9a-f]{64}$/),
    updatedAt: z.string().datetime({ offset: true })
  })
  .strict();

export type CommerceCardCheckpointV2 = z.infer<typeof commerceCardCheckpointV2Schema>;

export const taskAssignmentEventPayloadSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(64),
    sequence: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
    expectedStateVersion: z.number().int().positive(),
    eventType: z.string().trim().min(1).max(100),
    stage: commerceCardWorkflowStageSchema.nullable().optional(),
    fromState: taskAssignmentStateSchema.nullable().optional(),
    toState: taskAssignmentStateSchema.nullable().optional(),
    status: z.enum(["started", "succeeded", "failed", "skipped", "blocked", "checkpointed"]),
    reasonCode: z.string().trim().max(100).nullable().optional(),
    retryable: z.boolean().default(false),
    recoveryAction: z.string().trim().max(200).nullable().optional(),
    evidence: z.record(z.unknown()).default({}),
    occurredAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export type TaskAssignmentEventPayload = z.infer<typeof taskAssignmentEventPayloadSchema>;

export const taskAssignmentProgressPayloadSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(64),
    expectedStateVersion: z.number().int().positive(),
    stage: commerceCardWorkflowStageSchema,
    checkpoint: commerceCardCheckpointV2Schema,
    progress: z.record(z.unknown()).default({})
  })
  .strict();

export type TaskAssignmentProgressPayload = z.infer<typeof taskAssignmentProgressPayloadSchema>;

export const taskAssignmentCompletePayloadSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(64),
    expectedStateVersion: z.number().int().positive(),
    state: z.enum(["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]),
    terminalReason: z.string().trim().min(1).max(200),
    finalProgress: z.record(z.unknown()).default({}),
    occurredAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export type TaskAssignmentCompletePayload = z.infer<typeof taskAssignmentCompletePayloadSchema>;

export const commerceCardExecutionApprovalStatusSchema = z.enum(["ACTIVE", "REVOKED", "EXPIRED", "EXHAUSTED"]);

export const createCommerceCardExecutionApprovalSchema = z
  .object({
    targetId: z.string().uuid(),
    deviceCode: z.string().trim().min(1).max(64),
    expectedAccountId: z.string().trim().min(1).max(100).nullable().default(null),
    expectedAccountName: z.string().trim().min(1).max(100).nullable().default(null),
    maxCommentsPerRoom: z.number().int().min(1).max(5),
    totalQuota: z.number().int().min(1).max(500),
    accountDailyLimit: z.number().int().min(1).max(500),
    targetDailyLimit: z.number().int().min(1).max(500),
    cooldownSeconds: z.number().int().min(0).max(86400).default(0),
    validFrom: z.string().datetime({ offset: true }).optional(),
    expiresAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(3).max(500)
  })
  .strict()
  .refine((value) => Boolean(value.expectedAccountId || value.expectedAccountName), {
    message: "必须指定审批账号"
  });

export type CreateCommerceCardExecutionApprovalPayload = z.infer<typeof createCommerceCardExecutionApprovalSchema>;

export const revokeCommerceCardExecutionApprovalSchema = z.object({
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500)
}).strict();

export type RevokeCommerceCardExecutionApprovalPayload = z.infer<typeof revokeCommerceCardExecutionApprovalSchema>;

export const reserveCommerceCardCommentActionSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(64),
    expectedStateVersion: z.number().int().positive(),
    roomKeyVersion: z.number().int().positive(),
    roomKey: z.string().trim().min(8).max(200),
    commentSlot: z.number().int().nonnegative().max(20),
    commentHash: z.string().regex(/^[0-9a-f]{64}$/),
    replyText: z.string().trim().min(1).max(80),
    currentAccountId: z.string().trim().max(100).nullable().optional(),
    currentAccountName: z.string().trim().max(100).nullable().optional(),
    idempotencyKey: z.string().trim().min(16).max(220)
  })
  .strict();

export type ReserveCommerceCardCommentActionPayload = z.infer<typeof reserveCommerceCardCommentActionSchema>;

export const updateCommerceCardCommentActionSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(64),
    expectedActionStateVersion: z.number().int().positive(),
    state: z.enum(["submitting", "submitted", "sent", "unknown", "failed", "skipped"]),
    permitToken: z.string().trim().min(32).max(256).optional(),
    failureReason: z.string().trim().max(500).nullable().optional(),
    evidence: z.record(z.unknown()).default({}),
    occurredAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export type UpdateCommerceCardCommentActionPayload = z.infer<typeof updateCommerceCardCommentActionSchema>;

export const resolveCommerceCardCommentActionSchema = z
  .object({
    expectedActionStateVersion: z.number().int().positive(),
    resolution: z.enum(["sent", "failed"]),
    evidence: z.string().trim().min(3).max(1000)
  })
  .strict();

export type ResolveCommerceCardCommentActionPayload = z.infer<typeof resolveCommerceCardCommentActionSchema>;

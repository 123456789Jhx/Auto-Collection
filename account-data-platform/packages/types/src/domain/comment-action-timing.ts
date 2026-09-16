import { z } from "zod";

export const commentActionTimingActionKeys = [
  "openDouyin",
  "openSearchEntry",
  "setSearchKeyword",
  "submitSearch",
  "openLiveTab",
  "openFirstLive",
  "readViewerCount",
  "detectCommerceCart",
  "openAnchorSummary",
  "openAnchorProfile",
  "readRoomIdentity",
  "closeAnchorProfile",
  "readComments",
  "swipeComments",
  "nextLive",
  "finishRoomCapture",
  "commentOcrRetry"
] as const;

export const commentActionTimingRangeSchema = z
  .tuple([
    z.number().int().min(0).max(120_000),
    z.number().int().min(0).max(120_000)
  ])
  .refine(([minMs, maxMs]) => maxMs >= minMs, {
    message: "timing range max must be greater than or equal to min",
    path: [1]
  });

export const commentActionTimingPairSchema = z
  .object({
    beforeMs: commentActionTimingRangeSchema.optional(),
    afterMs: commentActionTimingRangeSchema.optional()
  })
  .strict();

const commentActionTimingActionsSchema = z
  .object({
    openDouyin: commentActionTimingPairSchema.optional(),
    openSearchEntry: commentActionTimingPairSchema.optional(),
    setSearchKeyword: commentActionTimingPairSchema.optional(),
    submitSearch: commentActionTimingPairSchema.optional(),
    openLiveTab: commentActionTimingPairSchema.optional(),
    openFirstLive: commentActionTimingPairSchema.optional(),
    readViewerCount: commentActionTimingPairSchema.optional(),
    detectCommerceCart: commentActionTimingPairSchema.optional(),
    openAnchorSummary: commentActionTimingPairSchema.optional(),
    openAnchorProfile: commentActionTimingPairSchema.optional(),
    readRoomIdentity: commentActionTimingPairSchema.optional(),
    closeAnchorProfile: commentActionTimingPairSchema.optional(),
    readComments: commentActionTimingPairSchema.optional(),
    swipeComments: commentActionTimingPairSchema.optional(),
    nextLive: commentActionTimingPairSchema.optional(),
    finishRoomCapture: commentActionTimingPairSchema.optional(),
    commentOcrRetry: commentActionTimingPairSchema.optional()
  })
  .strict();

export const commentActionTimingSchema = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean().default(true),
    actions: commentActionTimingActionsSchema.default({})
  })
  .strict();

export type CommentActionTiming = z.infer<typeof commentActionTimingSchema>;
export type CommentActionTimingActionKey = typeof commentActionTimingActionKeys[number];

export const defaultCommentActionTiming = {
  schemaVersion: 1,
  enabled: true,
  actions: {
    openDouyin: { beforeMs: [0, 0], afterMs: [5000, 7000] },
    openSearchEntry: { beforeMs: [0, 0], afterMs: [600, 1000] },
    setSearchKeyword: { beforeMs: [0, 0], afterMs: [500, 800] },
    submitSearch: { beforeMs: [0, 0], afterMs: [300, 900] },
    openLiveTab: { beforeMs: [0, 0], afterMs: [3500, 7000] },
    openFirstLive: { beforeMs: [0, 0], afterMs: [7500, 8500] },
    readViewerCount: { beforeMs: [0, 0], afterMs: [0, 0] },
    detectCommerceCart: { beforeMs: [0, 0], afterMs: [0, 0] },
    openAnchorSummary: { beforeMs: [5000, 7000], afterMs: [0, 0] },
    openAnchorProfile: { beforeMs: [5000, 7000], afterMs: [0, 0] },
    readRoomIdentity: { beforeMs: [5000, 7000], afterMs: [0, 0] },
    closeAnchorProfile: { beforeMs: [5000, 7000], afterMs: [0, 0] },
    readComments: { beforeMs: [0, 0], afterMs: [0, 0] },
    swipeComments: { beforeMs: [0, 0], afterMs: [2500, 4500] },
    nextLive: { beforeMs: [0, 0], afterMs: [7500, 8500] },
    finishRoomCapture: { beforeMs: [0, 0], afterMs: [800, 1200] },
    commentOcrRetry: { beforeMs: [350, 650], afterMs: [0, 0] }
  }
} as const satisfies CommentActionTiming;

export function resolveCommentActionTiming(profile: Record<string, unknown>): CommentActionTiming {
  const parsed = commentActionTimingSchema.safeParse(profile.commentActionTiming);
  const enabled = parsed.success ? parsed.data.enabled : true;
  const actions = Object.fromEntries(commentActionTimingActionKeys.map((key) => {
    const defaults = defaultCommentActionTiming.actions[key];
    const override = enabled && parsed.success ? parsed.data.actions[key] : undefined;
    return [key, {
      beforeMs: [...(override?.beforeMs ?? defaults.beforeMs)] as [number, number],
      afterMs: [...(override?.afterMs ?? defaults.afterMs)] as [number, number]
    }];
  })) as CommentActionTiming["actions"];

  const hasDedicatedOpenWait = enabled && parsed.success && Boolean(parsed.data.actions.openDouyin?.afterMs);
  if (!hasDedicatedOpenWait) {
    const legacyOpenWait = commentActionTimingRangeSchema.safeParse(profile.openDouyinWaitMs);
    if (legacyOpenWait.success && actions.openDouyin) {
      actions.openDouyin.afterMs = [...legacyOpenWait.data];
    }
  }

  return { schemaVersion: 1, enabled, actions };
}

export const updateCommentActionTimingSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime().nullable(),
    timing: commentActionTimingSchema.nullable()
  })
  .strict();

export const copyCommentActionTimingSchema = z
  .object({
    sourceDeviceCode: z.string().trim().min(1).max(100),
    platform: z.string().trim().min(1).max(32).default("douyin"),
    expectedUpdatedAt: z.string().datetime().nullable(),
    targets: z.array(z.object({
      deviceCode: z.string().trim().min(1).max(100),
      expectedUpdatedAt: z.string().datetime().nullable()
    }).strict()).min(1).max(200)
  })
  .strict()
  .refine((value) => !value.targets.some((target) => target.deviceCode === value.sourceDeviceCode), {
    message: "source device cannot be a copy target",
    path: ["targets"]
  })
  .refine((value) => new Set(value.targets.map((target) => target.deviceCode)).size === value.targets.length, {
    message: "copy targets must be unique",
    path: ["targets"]
  });

export type UpdateCommentActionTimingPayload = z.infer<typeof updateCommentActionTimingSchema>;
export type CopyCommentActionTimingPayload = z.infer<typeof copyCommentActionTimingSchema>;

import { z } from "zod";

const batchIdSchema = z.string().uuid();

export const accountWarmupRelatedTermsSchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;
  const normalized = value
    .flatMap((item) => String(item ?? "").split(/[，,\n]/))
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}, z.array(z.string().min(1).max(20)).min(1).max(30));

export const accountWarmupCommentLibrarySchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;
  const normalized = value
    .flatMap((item) => String(item ?? "").split(/[，,\n]/))
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}, z.array(z.string().min(1).max(100)).max(100).default([]));

export const accountWarmupCommentCountSchema = z.coerce.number().int().min(0).max(20).default(0);
export const accountWarmupDurationMinutesSchema = z.coerce.number().int().min(1).max(1440);

export const accountWarmupTargetLiveConfigSchema = z.object({
  targetKeyword: z.string().trim().min(1).max(100),
  relatedTerms: accountWarmupRelatedTermsSchema,
  commentLibrary: accountWarmupCommentLibrarySchema,
  commentCount: accountWarmupCommentCountSchema,
  singleLiveDurationMinutes: accountWarmupDurationMinutesSchema,
  totalWarmupDurationMinutes: accountWarmupDurationMinutesSchema,
  maxRounds: z.literal(3).default(3),
  candidatesPerRound: z.literal(4).default(4)
}).strict().superRefine((value, context) => {
  if (value.commentCount > 0 && !value.commentLibrary.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["commentLibrary"], message: "COMMENT_LIBRARY_REQUIRED" });
  }
});

export const accountWarmupVideoConfigSchema = z.object({
  targetKeyword: z.string().trim().min(1).max(100),
  secondsPerVideo: z.literal(10).default(10)
}).strict();

export const accountWarmupFeatureKeySchema = z.enum(["target_live_interaction", "video_warmup"]);

const accountWarmupTargetLiveRunPayloadSchema = z.object({
  featureKey: z.literal("target_live_interaction"),
  batchId: batchIdSchema,
  config: accountWarmupTargetLiveConfigSchema
}).strict();

const accountWarmupVideoRunPayloadSchema = z.object({
  featureKey: z.literal("video_warmup"),
  batchId: batchIdSchema,
  config: accountWarmupVideoConfigSchema
}).strict();

export const accountWarmupRunPayloadSchema = z.discriminatedUnion("featureKey", [
  accountWarmupTargetLiveRunPayloadSchema,
  accountWarmupVideoRunPayloadSchema
]);

export const accountWarmupStopPayloadSchema = z.object({
  batchId: batchIdSchema,
  targetCommandId: z.string().uuid()
}).strict();

export const videoWarmupStopPayloadSchema = z.object({
  featureKey: z.literal("video_warmup"),
  batchId: batchIdSchema,
  reason: z.literal("USER_REQUESTED")
}).strict();

export type AccountWarmupFeatureKey = z.infer<typeof accountWarmupFeatureKeySchema>;
export type AccountWarmupTargetLiveConfig = z.infer<typeof accountWarmupTargetLiveConfigSchema>;
export type AccountWarmupVideoConfig = z.infer<typeof accountWarmupVideoConfigSchema>;
export type AccountWarmupRunPayload = z.infer<typeof accountWarmupRunPayloadSchema>;
export type AccountWarmupStopPayload = z.infer<typeof accountWarmupStopPayloadSchema>;
export type VideoWarmupStopPayload = z.infer<typeof videoWarmupStopPayloadSchema>;

export const accountWarmupVocabularyKindSchema = z.enum(["RELATED_TERM", "COMMENT"]);

function vocabularyValuesSchema(limit: number) {
  return z.preprocess((value) => {
    if (!Array.isArray(value)) return value;
    const seen = new Set<string>();
    return value.flatMap((item) => {
      if (typeof item !== "string") return [item];
      const trimmed = item.trim();
      const normalized = trimmed.normalize("NFKC").toLowerCase();
      if (seen.has(normalized)) return [];
      seen.add(normalized);
      return [trimmed];
    });
  }, z.array(z.string().min(1).max(100)).max(limit));
}

export const accountWarmupVocabularyQuerySchema = z.object({
  kind: accountWarmupVocabularyKindSchema,
  query: z.string().trim().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(100)
}).strict();

export const accountWarmupVocabularySaveSchema = z.object({
  relatedTerms: vocabularyValuesSchema(50),
  comments: vocabularyValuesSchema(100)
}).strict();

export const accountWarmupVocabularyEntrySchema = z.object({
  id: z.string().uuid(),
  kind: accountWarmupVocabularyKindSchema,
  value: z.string().min(1).max(100),
  lastUsedAt: z.string().datetime()
});

export type AccountWarmupVocabularyKind = z.infer<typeof accountWarmupVocabularyKindSchema>;
export type AccountWarmupVocabularyQuery = z.infer<typeof accountWarmupVocabularyQuerySchema>;
export type AccountWarmupVocabularySavePayload = z.infer<typeof accountWarmupVocabularySaveSchema>;
export type AccountWarmupVocabularyEntry = z.infer<typeof accountWarmupVocabularyEntrySchema>;

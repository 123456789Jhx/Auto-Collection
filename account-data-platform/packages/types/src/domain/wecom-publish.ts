import { z } from "zod";

export const externalPublishPlatformSchema = z.enum(["抖音", "视频号"]);
export const publishPlatformSchema = z.enum(["DOUYIN", "WECHAT_CHANNELS"]);
export const externalPublishTaskStatusSchema = z.enum(["未发布", "待发布", "已发布"]);
export const publishTaskExternalStatusSchema = z.enum(["PENDING", "PUBLISHED"]);
export const publishTaskMatchStatusSchema = z.enum(["CLAIMED", "MATCHED", "UNMATCHED"]);

export type ExternalPublishPlatform = z.infer<typeof externalPublishPlatformSchema>;
export type PublishPlatform = z.infer<typeof publishPlatformSchema>;
export type ExternalPublishTaskStatus = z.infer<typeof externalPublishTaskStatusSchema>;
export type PublishTaskExternalStatus = z.infer<typeof publishTaskExternalStatusSchema>;
export type PublishTaskMatchStatus = z.infer<typeof publishTaskMatchStatusSchema>;

const externalPublishTaskBaseSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  platform: externalPublishPlatformSchema,
  status: externalPublishTaskStatusSchema,
  taskId: z.string().min(1),
  accountName: z.string().trim().min(1).nullable()
});

const httpUrlSchema = z.string().trim().url().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "URL must use http or https");

export const wecomPublishTaskSchema = externalPublishTaskBaseSchema.extend({
  coverUrl: httpUrlSchema,
  videoUrl: httpUrlSchema
}).strict();

export const claimedWecomPublishTaskSchema = externalPublishTaskBaseSchema.extend({
  coverUrl: z.string().trim().nullable().optional(),
  videoUrl: z.string().trim().nullable().optional()
}).strict();

export type WecomPublishTask = z.infer<typeof wecomPublishTaskSchema>;
export type ClaimedWecomPublishTask = z.infer<typeof claimedWecomPublishTaskSchema>;

export const claimPublishTaskPayloadSchema = z.object({
  platform: externalPublishPlatformSchema,
  accountName: z.string().trim().min(1)
}).strict();

export type ClaimPublishTaskPayload = z.infer<typeof claimPublishTaskPayloadSchema>;

export const claimPublishTaskResponseSchema = z.object({
  data: claimedWecomPublishTaskSchema.nullable()
}).strict();

export const patchPublishTaskStatusPayloadSchema = z.object({
  platform: externalPublishPlatformSchema,
  status: z.enum(["已发布", "未发布"]),
  error: z.string().optional(),
  publishedUrl: z.string().url().optional(),
  platformContentId: z.string().optional()
}).strict();

export type PatchPublishTaskStatusPayload = z.infer<typeof patchPublishTaskStatusPayloadSchema>;

export const externalPublishErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  }).strict()
}).strict();

export const claimPublishTaskOncePayloadSchema = z.object({
  configId: z.string().uuid()
}).strict();

const platformMap: Record<ExternalPublishPlatform, PublishPlatform> = {
  抖音: "DOUYIN",
  视频号: "WECHAT_CHANNELS"
};

const taskStatusMap: Record<ExternalPublishTaskStatus, PublishTaskExternalStatus> = {
  未发布: "PENDING",
  待发布: "PENDING",
  已发布: "PUBLISHED"
};

export function toPublishPlatform(value: ExternalPublishPlatform): PublishPlatform {
  return platformMap[value];
}

export function toPublishTaskStatus(value: ExternalPublishTaskStatus): PublishTaskExternalStatus {
  return taskStatusMap[value];
}

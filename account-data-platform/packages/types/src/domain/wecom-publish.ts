import { z } from "zod";

export const externalPublishPlatformSchema = z.enum(["抖音", "视频号"]);
export const publishPlatformSchema = z.enum(["DOUYIN", "WECHAT_CHANNELS"]);
export const externalPublishTaskStatusSchema = z.enum(["待发布", "已发布"]);
export const publishTaskExternalStatusSchema = z.enum(["PENDING", "PUBLISHED"]);
export const publishTaskMatchStatusSchema = z.enum(["CLAIMED", "MATCHED", "UNMATCHED"]);

export type ExternalPublishPlatform = z.infer<typeof externalPublishPlatformSchema>;
export type PublishPlatform = z.infer<typeof publishPlatformSchema>;
export type ExternalPublishTaskStatus = z.infer<typeof externalPublishTaskStatusSchema>;
export type PublishTaskExternalStatus = z.infer<typeof publishTaskExternalStatusSchema>;
export type PublishTaskMatchStatus = z.infer<typeof publishTaskMatchStatusSchema>;

export const wecomPublishTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  coverUrl: z.string().url().nullable(),
  videoUrl: z.string().url(),
  platform: externalPublishPlatformSchema,
  status: externalPublishTaskStatusSchema,
  taskId: z.string().min(1),
  accountName: z.string().min(1)
}).strict();

export type WecomPublishTask = z.infer<typeof wecomPublishTaskSchema>;

export const claimPublishTaskPayloadSchema = z.object({
  platform: externalPublishPlatformSchema,
  accountName: z.string().min(1).optional()
}).strict();

export type ClaimPublishTaskPayload = z.infer<typeof claimPublishTaskPayloadSchema>;

export const claimPublishTaskResponseSchema = z.object({
  data: wecomPublishTaskSchema.nullable()
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
  待发布: "PENDING",
  已发布: "PUBLISHED"
};

export function toPublishPlatform(value: ExternalPublishPlatform): PublishPlatform {
  return platformMap[value];
}

export function toPublishTaskStatus(value: ExternalPublishTaskStatus): PublishTaskExternalStatus {
  return taskStatusMap[value];
}

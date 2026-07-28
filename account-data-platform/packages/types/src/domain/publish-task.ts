import { z } from "zod";

export const publishTaskResultStatusSchema = z.enum([
  "SUCCEEDED",
  "FAILED",
  "TOPIC_PENDING",
  "MATERIAL_INVALID",
  "CHANNELS_VERIFY_PENDING"
]);

export const publishTaskResultPayloadSchema = z.object({
  deviceId: z.string().trim().min(1),
  deviceToken: z.string().min(1),
  status: publishTaskResultStatusSchema,
  error: z.string().trim().min(1).optional(),
  publishedUrl: z.string().url().optional(),
  platformContentId: z.string().trim().min(1).optional()
}).strict();

export const dispatchPublishTasksPayloadSchema = z.object({
  configId: z.string().uuid()
}).strict();

export const manualPublishTestPayloadSchema = z.object({
  configId: z.string().uuid(),
  deviceId: z.string().uuid(),
  platform: z.enum(["抖音", "视频号"]),
  videoUrl: z.string().trim().url(),
  coverUrl: z.string().trim().url().nullable().optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1)
}).strict();

export const completePublishTopicsPayloadSchema = z.object({
  description: z.string().trim().min(1)
}).strict();

export type PublishTaskResultStatus = z.infer<typeof publishTaskResultStatusSchema>;
export type PublishTaskResultPayload = z.infer<typeof publishTaskResultPayloadSchema>;
export type ManualPublishTestPayload = z.infer<typeof manualPublishTestPayloadSchema>;

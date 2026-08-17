import { z } from "zod";

export const publishTaskResultStatusSchema = z.enum([
  "SUCCEEDED",
  "FAILED",
  "TOPIC_PENDING",
  "MATERIAL_INVALID",
  "CHANNELS_VERIFY_PENDING",
  "PUBLISH_BUSY"
]);

export const publishMaterialFailureCodeSchema = z.enum([
  "MATERIAL_INVALID",
  "VIDEO_REQUIRED",
  "COVER_REQUIRED",
  "VIDEO_URL_INVALID",
  "COVER_URL_INVALID"
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

export const manualPublishTaskSourceSchema = z.enum([
  "MANUAL_TEST",
  "QUICK_PASTE"
]);

export const manualPublishTestPayloadSchema = z.object({
  configId: z.string().uuid(),
  deviceId: z.string().uuid(),
  platform: z.enum(["抖音", "视频号"]),
  videoUrl: z.string().trim().url(),
  coverUrl: z.string().trim().url(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1),
  source: manualPublishTaskSourceSchema.optional()
}).strict();

export const completePublishTopicsPayloadSchema = z.object({
  description: z.string().trim().min(1)
}).strict();

export type PublishTaskResultStatus = z.infer<typeof publishTaskResultStatusSchema>;
export type PublishMaterialFailureCode = z.infer<typeof publishMaterialFailureCodeSchema>;
export type PublishTaskResultPayload = z.infer<typeof publishTaskResultPayloadSchema>;
export type ManualPublishTaskSource = z.infer<typeof manualPublishTaskSourceSchema>;
export type ManualPublishTestPayload = z.infer<typeof manualPublishTestPayloadSchema>;

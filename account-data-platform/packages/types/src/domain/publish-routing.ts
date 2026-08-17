import { z } from "zod";

export const publishRoutingPlatformSchema = z.enum(["DOUYIN", "WECHAT_CHANNELS"]);
export type PublishRoutingPlatform = z.infer<typeof publishRoutingPlatformSchema>;

export const publishAccountBindingSchema = z.object({
  deviceCode: z.string().trim().min(1).max(64),
  platform: publishRoutingPlatformSchema,
  accountName: z.string().trim().min(1).max(100),
  accountNo: z.string().trim().max(100).optional(),
  externalAccountKey: z.string().trim().min(1).max(255),
  enabled: z.boolean().default(true)
}).strict();
export type PublishAccountBinding = z.infer<typeof publishAccountBindingSchema>;

export const publishAccountBindingUpdateSchema = z.object({
  bindings: z.array(publishAccountBindingSchema.omit({ deviceCode: true })).max(2)
}).strict();
export type PublishAccountBindingUpdate = z.infer<typeof publishAccountBindingUpdateSchema>;

export const publishTimeWindowSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
}).strict();
export type PublishTimeWindow = z.infer<typeof publishTimeWindowSchema>;

export const publishDeviceScheduleSchema = z.object({
  configId: z.string().uuid(),
  deviceCode: z.string().trim().min(1).max(64),
  platforms: z.array(publishRoutingPlatformSchema).min(1).max(2),
  timeWindows: z.array(publishTimeWindowSchema).min(1).max(8),
  enabled: z.boolean().default(true)
}).strict();
export type PublishDeviceSchedule = z.infer<typeof publishDeviceScheduleSchema>;

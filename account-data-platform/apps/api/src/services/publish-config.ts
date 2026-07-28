import { z } from "zod";

export const publishVideoConfigSchema = z.object({
  externalBaseUrl: z.string().url(),
  externalTokenEnv: z.string().min(1),
  publishTimeSlots: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(8).default([]),
  responseDelayMsMin: z.number().int().positive(),
  responseDelayMsMax: z.number().int().positive(),
  actionWaitMsMin: z.number().int().positive(),
  actionWaitMsMax: z.number().int().positive(),
  expectedTopicCount: z.number().int().min(1).max(10),
  requireCover: z.boolean().optional(),
  dailyLimitPerAccount: z.number().int().positive().default(1),
  downloadDir: z.string().optional()
}).passthrough();

export type PublishVideoConfig = {
  externalBaseUrl: string;
  externalTokenEnv: string;
  publishTimeSlots: string[];
  responseDelayMsMin: number;
  responseDelayMsMax: number;
  actionWaitMsMin: number;
  actionWaitMsMax: number;
  expectedTopicCount: number;
  requireCover?: boolean;
  dailyLimitPerAccount: number;
  downloadDir?: string;
};

export const publishClientOnlyConfigSchema = z.object({
  externalBaseUrl: z.string().url(),
  externalTokenEnv: z.string().min(1)
}).passthrough();

export function startOfLocalDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function localSlotDate(now: Date, slot: string) {
  const [hours, minutes] = slot.split(":").map(Number);
  const result = new Date(now);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function localTimeSlot(now: Date) {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

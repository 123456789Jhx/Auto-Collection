import { z } from "zod";

export const publishSourceModeSchema = z.enum(["direct_material", "external_pull"]);
export type PublishSourceMode = z.infer<typeof publishSourceModeSchema>;

const timeSlotSchema = z.array(
  z.string().regex(new RegExp("^([01]\\d|2[0-3]):[0-5]\\d$"))
).max(8).default([]);
const publishExecutionConfigSchema = z.object({
  responseDelayMsMin: z.number().int().positive(),
  responseDelayMsMax: z.number().int().positive(),
  actionWaitMsMin: z.number().int().positive(),
  actionWaitMsMax: z.number().int().positive(),
  expectedTopicCount: z.number().int().min(1).max(10).default(5),
  requireCover: z.boolean().default(true),
  topicResolveTimeoutMinutes: z.number().int().min(1).max(120).default(30),
  downloadDir: z.string().optional(),
  isDefault: z.boolean().default(false)
}).strip();

const directMaterialPublishConfigSchema = publishExecutionConfigSchema.extend({
  sourceMode: z.literal("direct_material")
}).strip();

const externalPullPublishConfigSchema = publishExecutionConfigSchema.extend({
  sourceMode: z.literal("external_pull").default("external_pull"),
  externalBaseUrl: z.string().url(),
  externalTokenEnv: z.string().min(1),
  publishTimeSlots: timeSlotSchema,
  platforms: z.array(z.enum(["\u6296\u97f3", "\u89c6\u9891\u53f7"])).min(1).max(2).default(["\u6296\u97f3", "\u89c6\u9891\u53f7"])
}).strip();

export const publishVideoConfigSchema = z.union([
  directMaterialPublishConfigSchema,
  externalPullPublishConfigSchema
]);

export type PublishExecutionConfig = z.infer<typeof publishExecutionConfigSchema>;
export type DirectMaterialPublishConfig = z.infer<typeof directMaterialPublishConfigSchema>;
export type PublishVideoConfig = z.infer<typeof externalPullPublishConfigSchema>;

export const publishClientOnlyConfigSchema = z.object({
  externalBaseUrl: z.string().url(),
  externalTokenEnv: z.string().min(1)
}).passthrough();

export type NormalizedPublishTimeWindow = { start: string; end: string };

export function normalizePublishTimeWindows(value: unknown): NormalizedPublishTimeWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") {
      const [start, end] = item.split("-");
      return start && end ? [{ start, end }] : [];
    }
    if (item && typeof item === "object") {
      const candidate = item as { start?: unknown; end?: unknown };
      if (typeof candidate.start === "string" && typeof candidate.end === "string") {
        return [{ start: candidate.start, end: candidate.end }];
      }
    }
    return [];
  });
}

function minutesOfDay(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isPublishTimeWithinWindows(now: Date, windows: NormalizedPublishTimeWindow[]) {
  const current = now.getHours() * 60 + now.getMinutes();
  return windows.some(({ start, end }) => {
    const startMinutes = minutesOfDay(start);
    const endMinutes = minutesOfDay(end);
    if (startMinutes < endMinutes) return current >= startMinutes && current < endMinutes;
    if (startMinutes > endMinutes) return current >= startMinutes || current < endMinutes;
    return false;
  });
}

export function localSlotDate(now: Date, slot: string) {
  const [hours, minutes] = slot.split(":").map(Number);
  const result = new Date(now);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function localTimeSlot(now: Date) {
  return String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
}

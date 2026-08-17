import { z } from "zod";

export const INTERFACE_PUBLISH_TIMEZONE = "Asia/Shanghai" as const;
export const INTERFACE_PUBLISH_MORNING_WINDOW = Object.freeze({
  start: "06:00",
  end: "12:00"
});
export const INTERFACE_PUBLISH_AFTERNOON_WINDOW = Object.freeze({
  start: "13:00",
  end: "24:00"
});

export const interfacePublishPlatformSchema = z.literal("DOUYIN");

export const interfacePublishRunStatusSchema = z.enum([
  "DRAFT",
  "CHECKING_BINDINGS",
  "WAITING_USER_CONFIRMATION",
  "SCHEDULED",
  "RUNNING",
  "STOPPING",
  "STOPPED",
  "PAUSED",
  "FAILED",
  "CANCELED"
]);

export const interfacePublishBindingStatusSchema = z.enum([
  "MATCHED",
  "BINDING_INCOMPLETE",
  "BINDING_CONFLICT",
  "DEVICE_OFFLINE",
  "DEVICE_BUSY",
  "UNBOUND",
  "SKIPPED_FOR_RUN"
]);

export const interfacePublishReservationStatusSchema = z.enum([
  "WAITING_DEVICE",
  "RESERVED",
  "RELEASING",
  "RELEASED"
]);

export const interfacePublishSlotSchema = z.enum(["MORNING", "AFTERNOON"]);

export const interfacePublishSlotStatusSchema = z.enum([
  "WAITING",
  "ELIGIBLE",
  "NO_MATERIAL",
  "DEVICE_UNAVAILABLE",
  "CLAIM_RESULT_UNKNOWN",
  "CLAIMED",
  "DISPATCHED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "RESULT_UNKNOWN",
  "SKIPPED_FOR_RUN",
  "WINDOW_EXPIRED"
]);

export const interfacePublishLocalResultSchema = z.enum([
  "PUBLISHED",
  "FAILED",
  "RESULT_UNKNOWN"
]);

export const interfacePublishErrorCategorySchema = z.enum([
  "INTERFACE_FLOW_FAILED",
  "PUBLISH_EXECUTION_FAILED",
  "EXTERNAL_SYNC_FAILED"
]);

export const interfacePublishAlertSeveritySchema = z.enum(["INFO", "WARNING", "ERROR"]);
export const interfacePublishAlertStatusSchema = z.enum(["OPEN", "RESOLVED"]);

const publishTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function timeInWindow(start: string, end: string) {
  const startMinutes = timeToMinutes(start);
  const endMinutes = end === "24:00" ? 24 * 60 : timeToMinutes(end);
  return publishTimeSchema.refine((value) => {
    const minutes = timeToMinutes(value);
    return minutes >= startMinutes && minutes < endMinutes;
  });
}

export const interfacePublishMorningTimeSchema = timeInWindow(
  INTERFACE_PUBLISH_MORNING_WINDOW.start,
  INTERFACE_PUBLISH_MORNING_WINDOW.end
);
export const interfacePublishAfternoonTimeSchema = timeInWindow(
  INTERFACE_PUBLISH_AFTERNOON_WINDOW.start,
  INTERFACE_PUBLISH_AFTERNOON_WINDOW.end
);

export const interfacePublishRunConfigSchema = z.object({
  configId: z.string().uuid(),
  morningPublishTime: interfacePublishMorningTimeSchema,
  afternoonPublishTime: interfacePublishAfternoonTimeSchema,
  maxConcurrentPublishing: z.number().int().positive().default(3),
  noMaterialRetryMinutes: z.number().int().positive().default(10),
  timezone: z.literal(INTERFACE_PUBLISH_TIMEZONE).default(INTERFACE_PUBLISH_TIMEZONE),
  platform: interfacePublishPlatformSchema.default("DOUYIN")
}).strict();

export const interfacePublishConfirmRunPayloadSchema = z.object({
  skippedBindingIds: z.array(z.string().uuid()).default([])
}).strict();

export const interfacePublishStopRunPayloadSchema = z.object({
  confirmedDailyFallbackRisk: z.literal(true)
}).strict();

export const interfacePublishPreflightBindingSchema = z.object({
  bindingId: z.string().uuid().nullable(),
  deviceId: z.string().trim().min(1).nullable(),
  externalAccountName: z.string().trim().min(1).nullable(),
  platformAccountId: z.string().trim().min(1).nullable(),
  status: interfacePublishBindingStatusSchema,
  message: z.string().trim().min(1).optional()
}).strict();

export const interfacePublishPreflightResultSchema = z.object({
  runId: z.string().uuid(),
  status: z.literal("WAITING_USER_CONFIRMATION"),
  bindings: z.array(interfacePublishPreflightBindingSchema),
  validBindingCount: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative()
}).strict();

export const interfacePublishSlotExecutionSchema = z.object({
  runId: z.string().uuid(),
  bindingId: z.string().uuid(),
  businessDate: z.string().date(),
  slot: interfacePublishSlotSchema,
  status: interfacePublishSlotStatusSchema,
  externalTaskId: z.string().trim().min(1).nullable().default(null),
  nextRetryAt: z.string().datetime().nullable().default(null),
  attemptCount: z.number().int().nonnegative().default(0),
  lastError: z.string().trim().min(1).nullable().default(null),
  publishedAt: z.string().datetime().nullable().default(null)
}).strict();

export const interfacePublishRunSummarySchema = z.object({
  runId: z.string().uuid(),
  status: interfacePublishRunStatusSchema,
  config: interfacePublishRunConfigSchema,
  activePublishingCount: z.number().int().nonnegative(),
  effectiveMaxConcurrentPublishing: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  stoppedAt: z.string().datetime().nullable(),
  slots: z.array(interfacePublishSlotExecutionSchema)
}).strict();

export const interfacePublishAlertSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  bindingId: z.string().uuid().nullable().default(null),
  slot: interfacePublishSlotSchema.nullable().default(null),
  category: interfacePublishErrorCategorySchema,
  severity: interfacePublishAlertSeveritySchema,
  status: interfacePublishAlertStatusSchema,
  message: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().default(null)
}).strict();

export const interfacePublishPhoneResultStatusSchema = z.enum([
  "SUCCEEDED",
  "PUBLISHED",
  "FAILED",
  "RESULT_UNKNOWN",
  "TOPIC_PENDING",
  "MATERIAL_INVALID",
  "CHANNELS_VERIFY_PENDING",
  "PUBLISH_BUSY"
]);

export const interfacePublishPhoneResultPayloadSchema = z.object({
  deviceId: z.string().trim().min(1),
  deviceToken: z.string().min(1),
  status: interfacePublishPhoneResultStatusSchema,
  error: z.string().trim().min(1).optional(),
  publishedUrl: z.string().url().optional(),
  platformContentId: z.string().trim().min(1).optional()
}).strict();

export type InterfacePublishPlatform = z.infer<typeof interfacePublishPlatformSchema>;
export type InterfacePublishRunStatus = z.infer<typeof interfacePublishRunStatusSchema>;
export type InterfacePublishBindingStatus = z.infer<typeof interfacePublishBindingStatusSchema>;
export type InterfacePublishReservationStatus = z.infer<typeof interfacePublishReservationStatusSchema>;
export type InterfacePublishSlot = z.infer<typeof interfacePublishSlotSchema>;
export type InterfacePublishSlotStatus = z.infer<typeof interfacePublishSlotStatusSchema>;
export type InterfacePublishLocalResult = z.infer<typeof interfacePublishLocalResultSchema>;
export type InterfacePublishErrorCategory = z.infer<typeof interfacePublishErrorCategorySchema>;
export type InterfacePublishRunConfig = z.infer<typeof interfacePublishRunConfigSchema>;
export type InterfacePublishConfirmRunPayload = z.infer<typeof interfacePublishConfirmRunPayloadSchema>;
export type InterfacePublishStopRunPayload = z.infer<typeof interfacePublishStopRunPayloadSchema>;
export type InterfacePublishPreflightResult = z.infer<typeof interfacePublishPreflightResultSchema>;
export type InterfacePublishRunSummary = z.infer<typeof interfacePublishRunSummarySchema>;
export type InterfacePublishSlotExecution = z.infer<typeof interfacePublishSlotExecutionSchema>;
export type InterfacePublishAlert = z.infer<typeof interfacePublishAlertSchema>;
export type InterfacePublishPhoneResultPayload = z.infer<typeof interfacePublishPhoneResultPayloadSchema>;

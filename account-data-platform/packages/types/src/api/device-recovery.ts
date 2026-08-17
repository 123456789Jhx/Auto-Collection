import { z } from "zod";
import { remoteWakeChannelSchema } from "./remote-wake-channel";

export const DEVICE_RECOVERY_SOURCES = ["AUTO_BOOT", "MANUAL_WAKE"] as const;
export const deviceRecoverySourceSchema = z.enum(DEVICE_RECOVERY_SOURCES);
export type DeviceRecoverySource = z.infer<typeof deviceRecoverySourceSchema>;

export const DEVICE_RECOVERY_STAGES = [
  "WAITING_DEVICE",
  "SYSTEM_BOOTED",
  "NETWORK_CONNECTED",
  "AGENT_LAUNCHED",
  "DEVICE_REGISTERED",
  "HEARTBEAT_RESTORED",
  "COMMAND_CHANNEL_READY"
] as const;
export const deviceRecoveryStageSchema = z.enum(DEVICE_RECOVERY_STAGES);
export type DeviceRecoveryStage = z.infer<typeof deviceRecoveryStageSchema>;

export const DEVICE_RECOVERY_RESULT_STATUSES = ["SUCCEEDED", "FAILED", "TIMED_OUT"] as const;
export const deviceRecoveryResultStatusSchema = z.enum(DEVICE_RECOVERY_RESULT_STATUSES);
export type DeviceRecoveryResultStatus = z.infer<typeof deviceRecoveryResultStatusSchema>;

export const DEVICE_RECOVERY_ERROR_CODES = [
  "DEVICE_UNREACHABLE",
  "NETWORK_READY_TIMEOUT",
  "AGENT_LAUNCH_TIMEOUT",
  "DEVICE_REGISTRATION_TIMEOUT",
  "HEARTBEAT_RESTORE_TIMEOUT",
  "COMMAND_CHANNEL_TIMEOUT",
  "SCREEN_WAKE_FAILED",
  "KEYGUARD_DISMISS_FAILED",
  "APP_LAUNCH_FAILED",
  "SECURE_KEYGUARD_REQUIRES_USER"
] as const;
export const deviceRecoveryErrorCodeSchema = z.enum(DEVICE_RECOVERY_ERROR_CODES);
export type DeviceRecoveryErrorCode = z.infer<typeof deviceRecoveryErrorCodeSchema>;

export const deviceRecoverySessionSchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().trim().min(1),
  commandId: z.string().uuid().optional(),
  source: deviceRecoverySourceSchema,
  channel: remoteWakeChannelSchema.optional(),
  stage: deviceRecoveryStageSchema,
  resultStatus: deviceRecoveryResultStatusSchema.optional(),
  errorCode: deviceRecoveryErrorCodeSchema.optional(),
  errorMessage: z.string().trim().max(500).optional(),
  startedAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional()
});
export type DeviceRecoverySession = z.infer<typeof deviceRecoverySessionSchema>;

export const deviceRecoveryStageReportSchema = z.object({
  deviceId: z.string().trim().min(1),
  sessionId: z.string().uuid().optional(),
  commandId: z.string().uuid().optional(),
  bootId: z.string().trim().min(1).max(128).optional(),
  eventKey: z.string().trim().min(1).max(200),
  source: deviceRecoverySourceSchema,
  channel: remoteWakeChannelSchema.optional(),
  stage: deviceRecoveryStageSchema,
  occurredAt: z.string().datetime({ offset: true }),
  reportedAt: z.string().datetime({ offset: true }),
  details: z.record(z.unknown()).optional()
});
export type DeviceRecoveryStageReport = z.infer<typeof deviceRecoveryStageReportSchema>;

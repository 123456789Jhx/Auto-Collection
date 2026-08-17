import { z } from "zod";

export const REMOTE_WAKE_ERROR_CODES = [
  "PUSH_CHANNEL_UNAVAILABLE",
  "PUSH_SEND_FAILED",
  "COMMAND_EXPIRED",
  "SCREEN_WAKE_FAILED",
  "KEYGUARD_DISMISS_FAILED",
  "TASK_CLEAR_FAILED",
  "APP_LAUNCH_FAILED",
  "UI_READY_TIMEOUT",
  "COMMAND_TIMED_OUT",
  "ACK_REJECTED"
] as const;

export const remoteWakeErrorCodeSchema = z.enum(REMOTE_WAKE_ERROR_CODES);

export type RemoteWakeErrorCode = z.infer<typeof remoteWakeErrorCodeSchema>;

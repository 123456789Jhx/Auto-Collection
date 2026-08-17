import { z } from "zod";

export const REMOTE_WAKE_STAGES = [
  "CREATED",
  "DISPATCHED",
  "DEVICE_RECEIVED",
  "SCREEN_ON",
  "KEYGUARD_DISMISSED",
  "TASK_CLEARED",
  "APP_LAUNCHED",
  "UI_READY"
] as const;

export const remoteWakeStageSchema = z.enum(REMOTE_WAKE_STAGES);

export type RemoteWakeStage = z.infer<typeof remoteWakeStageSchema>;

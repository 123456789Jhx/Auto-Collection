import { z } from "zod";

export const REMOTE_WAKE_RESULT_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT"
] as const;

export const remoteWakeResultStatusSchema = z.enum(REMOTE_WAKE_RESULT_STATUSES);

export type RemoteWakeResultStatus = z.infer<typeof remoteWakeResultStatusSchema>;

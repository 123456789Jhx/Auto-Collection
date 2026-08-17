import { z } from "zod";

export const REMOTE_WAKE_COMMAND_TYPE = "OPEN_AGENT_APP" as const;

export const remoteWakeCommandTypeSchema = z.literal(REMOTE_WAKE_COMMAND_TYPE);

export type RemoteWakeCommandType = z.infer<typeof remoteWakeCommandTypeSchema>;

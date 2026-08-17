import { z } from "zod";

export const REMOTE_WAKE_CHANNELS = ["AGENT_POLL", "XIAOMI_PUSH"] as const;

export const remoteWakeChannelSchema = z.enum(REMOTE_WAKE_CHANNELS);

export type RemoteWakeChannel = z.infer<typeof remoteWakeChannelSchema>;

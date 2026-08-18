import type { AccountWarmupStopPayload } from "@pkg/types";
import { mutate, request } from "./api-client";
import type { AccountWarmupMobileCommand } from "./api-client-account-warmup";
import type { LiveCommentEntryCommandInput } from "./live-comment-entry-form";

export type LiveCommentEntryMobileCommand = AccountWarmupMobileCommand & {
  createdAt?: string | null;
  updatedAt?: string | null;
  expiresAt?: string | null;
};

export function getLiveCommentEntryCommands(batchId?: string) {
  return request<LiveCommentEntryMobileCommand[]>("/admin/mobile-commands", {
    ...(batchId ? { batchId } : { featureKey: "live_comment_entry" })
  });
}

export function startLiveCommentEntryDevice(payload: {
  deviceId: string;
  payload: LiveCommentEntryCommandInput["payload"];
}) {
  return mutate<LiveCommentEntryMobileCommand>("/admin/mobile-commands", {
    deviceId: payload.deviceId,
    commandType: "ACCOUNT_WARMUP_RUN",
    payload: payload.payload,
    expiresInSeconds: 3600
  });
}

export function stopLiveCommentEntryDevice(payload: {
  deviceId: string;
  payload: AccountWarmupStopPayload;
}) {
  return mutate<LiveCommentEntryMobileCommand>("/admin/mobile-commands", {
    deviceId: payload.deviceId,
    commandType: "ACCOUNT_WARMUP_STOP",
    payload: payload.payload,
    expiresInSeconds: 600
  });
}

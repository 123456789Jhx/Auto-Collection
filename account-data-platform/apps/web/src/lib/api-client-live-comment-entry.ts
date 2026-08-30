import type { AccountWarmupStopPayload } from "@pkg/types";
import { mutate, request } from "./api-client";
import type { AccountWarmupMobileCommand, AccountWarmupVocabularyEntry } from "./api-client-account-warmup";
import type { LiveCommentEntryCommandInput } from "./live-comment-entry-form";

export type LiveCommentEntryMobileCommand = AccountWarmupMobileCommand & {
  createdAt?: string | null;
  updatedAt?: string | null;
  expiresAt?: string | null;
};

export function getLiveCommentEntryCommands(batchId?: string) {
  return request<LiveCommentEntryMobileCommand[]>("/admin/mobile-commands", {
    ...(batchId ? { batchId } : { featureKey: "isolated_live_comment_entry" })
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

export function saveLiveCommentEntryComments(comments: string[]) {
  return mutate<AccountWarmupVocabularyEntry[]>("/admin/account-warmup/vocabulary", {
    relatedTerms: [],
    comments
  });
}

export type PendingLiveCommentCandidate = {
  id: string;
  batchId: string;
  commentText: string;
  status: "PENDING" | "IMPORTED";
  sourcesJson: Array<{ deviceId?: string; roomKey?: string; pageIndex?: number | null; userName?: string }>;
};

export function getLiveCommentCandidates(batchId: string) {
  return request<PendingLiveCommentCandidate[]>("/admin/live-comment-candidates", { batchId });
}

export function confirmLiveCommentCandidates(batchId: string, candidateIds: string[]) {
  return mutate<{ selectedCount: number; importedCount: number }>("/admin/live-comment-candidates/confirm", {
    batchId,
    candidateIds
  });
}

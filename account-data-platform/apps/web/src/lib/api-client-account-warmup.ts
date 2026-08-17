import type { AccountWarmupRunPayload, AccountWarmupStopPayload } from "@pkg/types";
import { mutate, remove, request } from "./api-client";

export type AccountWarmupVocabularyKind = "RELATED_TERM" | "COMMENT";

export type AccountWarmupVocabularyEntry = {
  id: string;
  kind: AccountWarmupVocabularyKind;
  value: string;
  lastUsedAt: string;
};

export type AccountWarmupMobileCommand = {
  id: string;
  deviceId: string;
  commandType: string;
  status: string;
  payloadJson?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
  issuedAt?: string | null;
  fetchedAt?: string | null;
  acknowledgedAt?: string | null;
};

export function getAccountWarmupCommands() {
  return request<AccountWarmupMobileCommand[]>("/admin/mobile-commands");
}

export function getAccountWarmupVocabulary(
  kind: AccountWarmupVocabularyKind,
  query = "",
  limit = 100
) {
  return request<AccountWarmupVocabularyEntry[]>("/admin/account-warmup/vocabulary", {
    kind,
    query,
    limit
  });
}

export function saveAccountWarmupVocabulary(payload: {
  relatedTerms: string[];
  comments: string[];
}) {
  return mutate<AccountWarmupVocabularyEntry[]>("/admin/account-warmup/vocabulary", payload);
}

export function deleteAccountWarmupVocabulary(id: string) {
  return remove<{ ok: true; id: string }>(`/admin/account-warmup/vocabulary/${encodeURIComponent(id)}`);
}

export function startAccountWarmupDevice(payload: {
  deviceId: string;
  payload: AccountWarmupRunPayload;
}) {
  return mutate<AccountWarmupMobileCommand>("/admin/mobile-commands", {
    deviceId: payload.deviceId,
    commandType: "ACCOUNT_WARMUP_RUN",
    payload: payload.payload,
    expiresInSeconds: 3600
  });
}

export function stopAccountWarmupDevice(payload: {
  deviceId: string;
  payload: AccountWarmupStopPayload;
}) {
  return mutate<AccountWarmupMobileCommand>("/admin/mobile-commands", {
    deviceId: payload.deviceId,
    commandType: "ACCOUNT_WARMUP_STOP",
    payload: payload.payload,
    expiresInSeconds: 600
  });
}

export function stopVideoWarmupDevice(payload: {
  deviceId: string;
  payload: {
    featureKey: "video_warmup";
    batchId: string;
    reason: "USER_REQUESTED";
  };
}) {
  return mutate<AccountWarmupMobileCommand>("/admin/mobile-commands", {
    deviceId: payload.deviceId,
    commandType: "VIDEO_WARMUP_STOP",
    payload: payload.payload,
    expiresInSeconds: 600
  });
}

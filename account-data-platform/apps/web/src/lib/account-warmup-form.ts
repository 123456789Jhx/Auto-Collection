import type { AccountWarmupRunPayload } from "@pkg/types";

export type AccountWarmupCommandInput = {
  deviceId: string;
  commandType: "ACCOUNT_WARMUP_RUN";
  payload: AccountWarmupRunPayload;
  expiresInSeconds: number;
};

export type AccountWarmupCommandView = {
  id?: string;
  deviceId?: string;
  commandType?: string;
  status?: string;
  payloadJson?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
  expiresAt?: string | null;
};

type VideoWarmupDeviceView = {
  id: string;
  deviceCode: string;
  deviceName?: string;
  douyinAccountName?: string | null;
  enabled?: boolean;
  effectiveStatus: string;
  accountProfile?: Record<string, unknown> | null;
};

export type VideoWarmupStopCommandInput = {
  deviceId: string;
  commandType: "VIDEO_WARMUP_STOP";
  payload: {
    featureKey: "video_warmup";
    batchId: string;
    reason: "USER_REQUESTED";
  };
  expiresInSeconds: number;
};

export type SharedVocabularyKind = "RELATED_TERM" | "COMMENT";

export type SharedVocabularyEntry = {
  id: string;
  kind: SharedVocabularyKind;
  value: string;
  lastUsedAt: string;
};

type AccountWarmupBatchStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const activeBatchStorageKey = "account-warmup-active-batch-id";
const activeVideoWarmupBatchStorageKey = "video-warmup-active-batch-id";
const lastVideoWarmupKeywordStorageKey = "video-warmup-last-keyword";
const videoWarmupDeviceKeywordsStorageKey = "video-warmup-device-keywords";

export const VIDEO_WARMUP_DEFAULT_KEYWORD = "药材种植";
export const VIDEO_WARMUP_SECONDS_PER_VIDEO = 10;

export function selectOnlineVideoWarmupDevices<T extends VideoWarmupDeviceView>(devices: T[]) {
  return devices.filter((device) => device.enabled !== false && device.effectiveStatus !== "offline");
}

export function videoWarmupDeviceName(device: VideoWarmupDeviceView) {
  const boundName = device.accountProfile?.douyinAccountName;
  if (typeof boundName === "string" && boundName.trim()) return boundName.trim();
  return device.douyinAccountName?.trim() || device.deviceName?.trim() || device.deviceCode;
}

function browserStorage(): AccountWarmupBatchStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readLastVideoWarmupKeyword(storage = browserStorage()) {
  const saved = storage?.getItem(lastVideoWarmupKeywordStorageKey)?.trim().slice(0, 100) ?? "";
  return saved || VIDEO_WARMUP_DEFAULT_KEYWORD;
}

export function writeLastVideoWarmupKeyword(keyword: string, storage = browserStorage()) {
  if (!storage) return;
  const normalized = keyword.trim().slice(0, 100);
  if (normalized) storage.setItem(lastVideoWarmupKeywordStorageKey, normalized);
  else storage.removeItem(lastVideoWarmupKeywordStorageKey);
}

export function readVideoWarmupDeviceKeywords(storage = browserStorage()): Record<string, string> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(videoWarmupDeviceKeywordsStorageKey) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([deviceCode, keyword]) => {
      const normalizedDeviceCode = deviceCode.trim();
      const normalizedKeyword = typeof keyword === "string" ? keyword.trim().slice(0, 100) : "";
      return normalizedDeviceCode && normalizedKeyword ? [[normalizedDeviceCode, normalizedKeyword]] : [];
    }));
  } catch {
    return {};
  }
}

export function writeVideoWarmupDeviceKeyword(deviceCode: string, keyword: string, storage = browserStorage()) {
  if (!storage || !deviceCode.trim()) return;
  const keywords = readVideoWarmupDeviceKeywords(storage);
  const normalizedKeyword = keyword.trim().slice(0, 100);
  if (normalizedKeyword) keywords[deviceCode.trim()] = normalizedKeyword;
  else delete keywords[deviceCode.trim()];
  if (Object.keys(keywords).length) storage.setItem(videoWarmupDeviceKeywordsStorageKey, JSON.stringify(keywords));
  else storage.removeItem(videoWarmupDeviceKeywordsStorageKey);
}

export function clearVideoWarmupDeviceKeyword(deviceCode: string, storage = browserStorage()) {
  writeVideoWarmupDeviceKeyword(deviceCode, "", storage);
}

export function resolveVideoWarmupKeyword(
  deviceCode: string,
  sharedKeyword: string,
  deviceKeywords: Record<string, string>
) {
  return deviceKeywords[deviceCode.trim()]?.trim().slice(0, 100) ||
    sharedKeyword.trim().slice(0, 100) || VIDEO_WARMUP_DEFAULT_KEYWORD;
}

export function readActiveAccountWarmupBatchId(storage = browserStorage()) {
  return storage?.getItem(activeBatchStorageKey)?.trim() ?? "";
}

export function writeActiveAccountWarmupBatchId(batchId: string, storage = browserStorage()) {
  if (!storage) return;
  const normalized = batchId.trim();
  if (normalized) storage.setItem(activeBatchStorageKey, normalized);
  else storage.removeItem(activeBatchStorageKey);
}

export function readActiveVideoWarmupBatchId(storage = browserStorage()) {
  return storage?.getItem(activeVideoWarmupBatchStorageKey)?.trim() ?? "";
}

export function writeActiveVideoWarmupBatchId(batchId: string, storage = browserStorage()) {
  if (!storage) return;
  const normalized = batchId.trim();
  if (normalized) storage.setItem(activeVideoWarmupBatchStorageKey, normalized);
  else storage.removeItem(activeVideoWarmupBatchStorageKey);
}

export function normalizeRelatedTerms(values: string[]) {
  const result: string[] = [];
  values.flatMap((value) => String(value).split(/[，,\n]/)).forEach((value) => {
    const normalized = value.trim();
    if (normalized && !result.includes(normalized)) result.push(normalized);
  });
  return result;
}

export function normalizeCommentLibrary(values: string[]) {
  const result: string[] = [];
  values.flatMap((value) => String(value).split(/[，,\n]/)).forEach((value) => {
    const normalized = value.trim();
    if (normalized && !result.includes(normalized)) result.push(normalized);
  });
  return result;
}

export function resolveSharedVocabularyOption(data: unknown): {
  label: string;
  entry: SharedVocabularyEntry | null;
} {
  const option = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const labelValue = option.label ?? option.value ?? "";
  const label = typeof labelValue === "string" ? labelValue : String(labelValue);
  const entry = option.entry && typeof option.entry === "object"
    ? option.entry as Record<string, unknown>
    : null;
  const isEntry = entry !== null &&
    typeof entry.id === "string" &&
    (entry.kind === "RELATED_TERM" || entry.kind === "COMMENT") &&
    typeof entry.value === "string" &&
    typeof entry.lastUsedAt === "string";
  return {
    label,
    entry: isEntry ? entry as SharedVocabularyEntry : null
  };
}

export function sharedVocabularyInvalidationKey(kind: SharedVocabularyKind) {
  return ["accountWarmupVocabulary", kind];
}

export function getSharedVocabularyQueryState(isError: boolean) {
  return {
    allowManualInput: true,
    hint: isError ? "共享历史加载失败，仍可手动输入" : ""
  };
}

export function getSharedVocabularyDeleteError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return `共享历史删除失败：${error.message}`;
  }
  return "共享历史删除失败，请稍后重试";
}

export function buildAccountWarmupCommands(input: {
  batchId: string;
  targetKeyword: string;
  relatedTerms: string[];
  commentLibrary?: string[];
  commentCount?: number;
  singleLiveDurationMinutes: number;
  totalWarmupDurationMinutes: number;
  deviceCodes: string[];
}): AccountWarmupCommandInput[] {
  const targetKeyword = input.targetKeyword.trim();
  const relatedTerms = normalizeRelatedTerms(input.relatedTerms);
  return input.deviceCodes.map((deviceId) => ({
    deviceId,
    commandType: "ACCOUNT_WARMUP_RUN",
    payload: {
      featureKey: "target_live_interaction",
      batchId: input.batchId,
      config: {
        targetKeyword,
        relatedTerms,
        commentLibrary: normalizeCommentLibrary(input.commentLibrary ?? []),
        commentCount: Math.max(0, Math.min(20, Math.floor(Number(input.commentCount) || 0))),
        singleLiveDurationMinutes: Math.floor(Number(input.singleLiveDurationMinutes)),
        totalWarmupDurationMinutes: Math.floor(Number(input.totalWarmupDurationMinutes)),
        maxRounds: 3,
        candidatesPerRound: 4
      }
    },
    expiresInSeconds: 3600
  }));
}

export function buildVideoWarmupCommands(input: {
  batchId: string;
  targetKeyword: string;
  deviceCodes: string[];
  deviceKeywords?: Record<string, string>;
}): AccountWarmupCommandInput[] {
  const targetKeyword = input.targetKeyword.trim();
  if (!targetKeyword) return [];
  return [...new Set(input.deviceCodes.map((value) => value.trim()).filter(Boolean))].map((deviceId) => ({
    deviceId,
    commandType: "ACCOUNT_WARMUP_RUN",
    payload: {
      featureKey: "video_warmup",
      batchId: input.batchId,
      config: {
        targetKeyword: resolveVideoWarmupKeyword(deviceId, targetKeyword, input.deviceKeywords ?? {}),
        secondsPerVideo: VIDEO_WARMUP_SECONDS_PER_VIDEO
      }
    },
    expiresInSeconds: 3600
  }));
}

export function buildVideoWarmupStopCommands(input: {
  batchId: string;
  rows: Array<{ id: string; deviceCode: string; status: string }>;
}): VideoWarmupStopCommandInput[] {
  const batchId = input.batchId.trim();
  const seen = new Set<string>();
  return input.rows.flatMap((row) => {
    const deviceId = row.deviceCode.trim();
    if (!batchId || !deviceId || seen.has(deviceId) || ["DONE", "FAILED", "IGNORED"].includes(row.status)) {
      return [];
    }
    seen.add(deviceId);
    return [{
      deviceId,
      commandType: "VIDEO_WARMUP_STOP" as const,
      payload: {
        featureKey: "video_warmup" as const,
        batchId,
        reason: "USER_REQUESTED" as const
      },
      expiresInSeconds: 600
    }];
  });
}

export function resolveVideoWarmupCommandState(
  runCommand: AccountWarmupCommandView,
  commands: AccountWarmupCommandView[],
  batchId: string,
  nowMs = Date.now()
) {
  const resultStatus = String(runCommand.resultJson?.status ?? "");
  const expiresAtMs = runCommand.expiresAt ? Date.parse(runCommand.expiresAt) : Number.NaN;
  if (runCommand.status === "PENDING" && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    return { key: "expired", label: "Expired", color: "default", active: false };
  }
  if (resultStatus === "STOPPED") return { key: "stopped", label: "已停止", color: "default", active: false };

  const stopCommand = commands.find((command) =>
    command.commandType === "VIDEO_WARMUP_STOP" &&
    command.deviceId === runCommand.deviceId &&
    command.payloadJson?.featureKey === "video_warmup" &&
    command.payloadJson?.batchId === batchId);
  if (stopCommand?.status === "FAILED") {
    return { key: "stop_failed", label: "停止失败", color: "error", active: true };
  }
  if (stopCommand?.status === "DONE" || stopCommand?.status === "IGNORED") {
    return { key: "stopped", label: "已停止", color: "default", active: false };
  }
  if (stopCommand) return { key: "stopping", label: "停止中", color: "warning", active: true };

  if (runCommand.status === "PENDING") return { key: "pending", label: "等待下发", color: "processing", active: true };
  if (runCommand.status === "FETCHED") return { key: "running", label: "刷视频中", color: "processing", active: true };
  if (runCommand.status === "FAILED") return { key: "failed", label: "执行失败", color: "error", active: false };
  if (runCommand.status === "DONE" || runCommand.status === "IGNORED") {
    return { key: "completed", label: "已完成", color: "success", active: false };
  }
  return { key: "unknown", label: runCommand.status || "未知", color: "default", active: false };
}

export async function dispatchAccountWarmupCommands<T>(
  commands: AccountWarmupCommandInput[],
  dispatch: (command: AccountWarmupCommandInput) => Promise<T>
) {
  const results = await Promise.allSettled(commands.map((command) => dispatch(command)));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  return {
    succeededCount: results.length - failures.length,
    failedCount: failures.length,
    firstError: failures[0]?.reason
  };
}

export async function dispatchAccountWarmupCommandsAndSaveVocabulary<T>(
  commands: AccountWarmupCommandInput[],
  dispatch: (command: AccountWarmupCommandInput) => Promise<T>,
  saveVocabulary: (payload: { relatedTerms: string[]; comments: string[] }) => Promise<unknown>
) {
  const result = await dispatchAccountWarmupCommands(commands, dispatch);
  if (!result.succeededCount) return { ...result, vocabularySaveError: undefined };

  const payload = commands[0]?.payload;
  if (!payload || payload.featureKey !== "target_live_interaction") {
    return { ...result, vocabularySaveError: undefined };
  }
  const config = payload.config;
  try {
    await saveVocabulary({
      relatedTerms: normalizeRelatedTerms(config?.relatedTerms ?? []),
      comments: normalizeCommentLibrary(config?.commentLibrary ?? [])
    });
    return { ...result, vocabularySaveError: undefined };
  } catch (error) {
    return {
      ...result,
      vocabularySaveError: error instanceof Error ? error : new Error(String(error))
    };
  }
}

export async function dispatchAccountWarmupStops<T extends { id: string }>(
  commands: T[],
  dispatch: (command: T) => Promise<unknown>
) {
  const results = await Promise.allSettled(commands.map((command) => dispatch(command)));
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  let firstError: unknown;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") succeededIds.push(commands[index].id);
    else {
      failedIds.push(commands[index].id);
      firstError ??= result.reason;
    }
  });
  return {
    succeededIds,
    failedIds,
    succeededCount: succeededIds.length,
    failedCount: failedIds.length,
    firstError
  };
}

export function mapAccountWarmupCommandStatus(command: AccountWarmupCommandView, stopRequested = false) {
  const resultStatus = String(command.resultJson?.status ?? "");
  if (resultStatus === "TARGET_LIVE_ENTERED") return { label: "已进入", color: "success" };
  if (resultStatus === "TARGET_LIVE_NOT_FOUND") return { label: "未找到", color: "warning" };
  if (resultStatus === "STOPPED") return { label: "已停止", color: "default" };
  if (stopRequested) return { label: "停止中", color: "warning" };
  if (command.status === "PENDING") return { label: "等待下发", color: "processing" };
  if (command.status === "FETCHED") return { label: "搜索中", color: "processing" };
  if (command.status === "FAILED") return { label: "执行失败", color: "error" };
  return { label: command.status || "未知", color: "default" };
}

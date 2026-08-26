import type { AccountWarmupRunPayload, AccountWarmupStopPayload } from "@pkg/types";

type LiveCommentEntryRunPayload = Extract<AccountWarmupRunPayload, { featureKey: "isolated_live_comment_entry" }>;

export type LiveCommentEntryCommandInput = {
  deviceId: string;
  commandType: "ACCOUNT_WARMUP_RUN";
  payload: LiveCommentEntryRunPayload;
  expiresInSeconds: number;
};

export type LiveCommentEntryCommandView = {
  id?: string;
  deviceId?: string;
  commandType?: string;
  status?: string;
  payloadJson?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
  issuedAt?: string | null;
  fetchedAt?: string | null;
  acknowledgedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
};

export type LiveCommentEntryStopInput = {
  id: string;
  deviceId: string;
  payload: AccountWarmupStopPayload;
};

type BatchStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type LiveCommentEntryState = {
  key: "pending" | "running" | "stopping" | "entered" | "captured" | "cleanup_failed" | "failed" | "platform_verification" | "viewer_count_failed" | "viewer_threshold_exhausted" | "live_ended_exhausted" | "live_ended_skip_failed" | "stopped" | "ignored" | "unknown";
  label: string;
  color: string;
  active: boolean;
  stage: string;
  stageLabel: string;
  stageHistory: string[];
  message: string;
};

export type LiveCommentEntryStopState = "none" | "pending" | "done" | "failed";

const activeBatchStorageKey = "live-comment-entry-active-batch-id";
const lastInputStorageKey = "live-comment-entry-last-input";

export const LIVE_COMMENT_ENTRY_DEFAULT_MIN_VIEWERS = 300;

const stageLabels: Record<string, string> = {
  OPENING_DOUYIN: "打开抖音",
  OPENING_SEARCH: "打开搜索",
  INPUT_KEYWORD: "输入直播间关键词",
  OPENING_LIVE_TAB: "切换到直播结果",
  OPENING_FIRST_RESULT: "打开第一个直播间",
  PLATFORM_VERIFICATION: "平台验证",
  CHECKING_VIEWER_COUNT: "检测直播间人数",
  VIEWER_COUNT_ACCEPTED: "人数达到下限",
  SKIPPING_LOW_VIEWER_ROOM: "人数不足，切换直播间",
  SKIPPING_ENDED_LIVE_ROOM: "直播已结束，切换直播间",
  CAPTURING_COMMENTS: "识别评论",
  RETRYING_COMMENT_OCR: "重试评论识别",
  COMMENT_PAGE_CAPTURED: "本页评论识别完成",
  SWIPING_COMMENTS: "上滑评论区",
  COMMENTS_CAPTURED: "评论抓取完成",
  COMMENT_CAPTURE_FAILED: "评论抓取失败",
  CLEANING_UP: "退出抖音",
  RETURNING_TO_AGENT: "返回燎原星火",
  CLEANUP_COMPLETED: "任务收尾完成",
  RETRYING_SEARCH: "重新搜索直播间",
  ENTERED: "已进入直播间",
  STOPPED: "已停止",
  FAILED: "执行失败"
};

function browserStorage(): BatchStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function normalizedViewerFloor(value: unknown) {
  if (value === undefined || value === null || value === "") return LIVE_COMMENT_ENTRY_DEFAULT_MIN_VIEWERS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("直播间人数下限必须是非负整数");
  return parsed;
}

export function buildLiveCommentEntryCommands(input: {
  batchId: string;
  targetKeyword: string;
  minViewerCount?: number | null;
  deviceCodes: string[];
}): LiveCommentEntryCommandInput[] {
  const batchId = input.batchId.trim();
  const targetKeyword = input.targetKeyword.trim();
  if (!batchId) throw new Error("任务批次不能为空");
  if (!targetKeyword) throw new Error("请输入目标直播间关键词");
  if (targetKeyword.length > 100) throw new Error("目标直播间关键词不能超过 100 个字符");
  const minViewerCount = normalizedViewerFloor(input.minViewerCount);
  const deviceCodes = [...new Set(input.deviceCodes.map((value) => value.trim()).filter(Boolean))];
  return deviceCodes.map((deviceId) => ({
    deviceId,
    commandType: "ACCOUNT_WARMUP_RUN",
    payload: {
      featureKey: "isolated_live_comment_entry",
      batchId,
      config: { targetKeyword, minViewerCount }
    },
    expiresInSeconds: 3600
  }));
}

export function buildLiveCommentEntryStopCommands(input: {
  batchId: string;
  rows: Array<{ id: string; deviceCode: string; status: string }>;
}): LiveCommentEntryStopInput[] {
  const batchId = input.batchId.trim();
  const seen = new Set<string>();
  return input.rows.flatMap((row) => {
    const deviceId = row.deviceCode.trim();
    if (!batchId || !deviceId || !row.id || seen.has(deviceId) || isTerminalStatus(row.status)) return [];
    seen.add(deviceId);
    return [{ id: row.id, deviceId, payload: { batchId, targetCommandId: row.id } }];
  });
}

export function liveCommentEntryStageLabel(stage: unknown) {
  const normalized = typeof stage === "string" ? stage.trim() : "";
  return stageLabels[normalized] ?? (normalized || "等待设备领取");
}

export function resolveLiveCommentEntryStopState(
  command: LiveCommentEntryCommandView | undefined,
  nowMs = Date.now()
): LiveCommentEntryStopState {
  if (!command) return "none";
  if (["FAILED", "TIMED_OUT", "IGNORED"].includes(String(command.status || ""))) return "failed";
  if (command.status === "DONE") return "done";
  const expiresAtMs = command.expiresAt ? Date.parse(command.expiresAt) : Number.NaN;
  if (command.status === "PENDING" && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) return "failed";
  return "pending";
}

export function resolveLiveCommentEntryState(
  command: LiveCommentEntryCommandView,
  stopState: LiveCommentEntryStopState = "none",
  nowMs = Date.now()
): LiveCommentEntryState {
  const result = command.resultJson ?? {};
  const resultStatus = stringValue(result.status);
  const commandTerminal = isTerminalStatus(String(command.status || ""));
  const cleanupFailed = resultStatus === "LIVE_COMMENT_ENTRY_CLEANUP_FAILED";
  const reportedStage = stringValue(result.stage);
  const failedStage = stringValue(result.failedStage);
  const platformVerification = result.platformVerification === true ||
    result.reasonCode === "PLATFORM_VERIFICATION" ||
    result.reasonCode === "CAPTURE_PLATFORM_VERIFICATION" ||
    resultStatus === "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION" ||
    resultStatus === "LIVE_COMMENT_ENTRY_CAPTURE_PLATFORM_VERIFICATION";
  const viewerCountFailed = resultStatus === "LIVE_COMMENT_ENTRY_VIEWER_COUNT_FAILED" ||
    resultStatus === "LIVE_COMMENT_ENTRY_VIEWER_THRESHOLD_FAILED" ||
    result.reasonCode === "VIEWER_COUNT_READ_FAILED" ||
    result.reasonCode === "NEXT_LIVE_ROOM_FAILED";
  const viewerThresholdExhausted = resultStatus === "LIVE_COMMENT_ENTRY_VIEWER_THRESHOLD_EXHAUSTED" ||
    result.reasonCode === "VIEWER_THRESHOLD_NOT_MET";
  const liveEndedExhausted = resultStatus === "LIVE_COMMENT_ENTRY_LIVE_ENDED_EXHAUSTED" ||
    result.reasonCode === "LIVE_ROOM_ENDED";
  const liveEndedSkipFailed = resultStatus === "LIVE_COMMENT_ENTRY_LIVE_ENDED_SKIP_FAILED" ||
    (result.reasonCode === "NEXT_LIVE_ROOM_FAILED" && failedStage === "SKIPPING_ENDED_LIVE_ROOM");
  const failed = resultStatus === "LIVE_COMMENT_ENTRY_FAILED" ||
    resultStatus === "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED" || command.status === "FAILED";
  const stage = failed ? (failedStage || reportedStage) : (reportedStage || failedStage);
  const stageHistory = Array.isArray(result.stageHistory)
    ? result.stageHistory.filter((item): item is string => typeof item === "string").slice(-20).map(liveCommentEntryStageLabel)
    : [];
  const message = stringValue(result.message) || stringValue(result.reason);

  if (platformVerification) {
    return state("platform_verification", "平台验证", "error", false,
      stage || "PLATFORM_VERIFICATION", stageHistory, message || "出现平台验证");
  }

  if (viewerThresholdExhausted) {
    return state("viewer_threshold_exhausted", "人数未达标", "error", false,
      stage || "CHECKING_VIEWER_COUNT", stageHistory, message || "连续直播间人数均未达到下限，脚本已停止");
  }

  if (liveEndedExhausted) {
    return state("live_ended_exhausted", "直播已结束", "error", false,
      stage || "SKIPPING_ENDED_LIVE_ROOM", stageHistory, message || "连续直播间均已结束，脚本已停止");
  }

  if (liveEndedSkipFailed) {
    return state("live_ended_skip_failed", "切换直播间失败", "error", false,
      stage || "SKIPPING_ENDED_LIVE_ROOM", stageHistory, message || "直播已结束后切换下一个直播间失败，脚本已停止");
  }

  if (viewerCountFailed) {
    return state("viewer_count_failed", "人数检测失败", "error", false,
      stage || "CHECKING_VIEWER_COUNT", stageHistory, message || "无法识别直播间人数，脚本已停止");
  }

  if (cleanupFailed) {
    return state("cleanup_failed", "收尾失败", "error", false,
      failedStage || reportedStage || "CLEANING_UP", stageHistory,
      message || "评论已抓取，但退出抖音或返回燎原星火失败");
  }

  if (failed) {
    return state("failed", "执行失败", "error", false, stage || "FAILED", stageHistory, message);
  }
  if (isLiveCommentEntryCaptureCompleted(command) && commandTerminal) {
    return state("captured", "抓取完成", "success", false,
      reportedStage || "COMMENTS_CAPTURED", stageHistory, message);
  }
  if (resultStatus === "LIVE_COMMENT_ENTRY_ENTERED" && commandTerminal) {
    return state("entered", "已进入", "success", false, stage || "ENTERED", stageHistory, message);
  }
  if (resultStatus === "LIVE_COMMENT_ENTRY_STOPPED" || stopState === "done") {
    return state("stopped", "已停止", "default", false, stage || "STOPPED", stageHistory, message);
  }
  if (command.status === "TIMED_OUT") {
    return state("failed", "执行超时", "error", false, stage || "FAILED", stageHistory, message || "设备未在有效期内完成任务");
  }
  if (command.status === "IGNORED") {
    return state("ignored", "已忽略", "default", false, stage, stageHistory, message);
  }
  const expiresAtMs = command.expiresAt ? Date.parse(command.expiresAt) : Number.NaN;
  if (command.status === "PENDING" && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    return state("failed", "执行超时", "error", false, stage || "FAILED", stageHistory,
      message || "设备未在有效期内领取任务");
  }
  if (stopState === "failed") {
    return state("running", "停止失败", "error", true, stage, stageHistory, message || "停止命令执行失败");
  }
  if (stopState === "pending") {
    return state("stopping", "停止中", "warning", true, stage, stageHistory, message);
  }
  if (command.status === "PENDING") {
    return state("pending", "等待下发", "processing", true, stage, stageHistory, message);
  }
  if (["FETCHED", "CLAIMED", "RUNNING"].includes(String(command.status || ""))) {
    return state("running", "执行中", "processing", true, stage, stageHistory, message);
  }
  if (command.status === "DONE") {
    return state("unknown", "已完成", "default", false, stage, stageHistory, message);
  }
  return state("unknown", String(command.status || "未知"), "default", false, stage, stageHistory, message);
}

function state(
  key: LiveCommentEntryState["key"],
  label: string,
  color: string,
  active: boolean,
  stage: string,
  stageHistory: string[],
  message: string
): LiveCommentEntryState {
  return { key, label, color, active, stage, stageLabel: liveCommentEntryStageLabel(stage), stageHistory, message };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isBatchId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTerminalStatus(status: string) {
  return ["DONE", "FAILED", "IGNORED", "TIMED_OUT"].includes(status);
}

export function summarizeLiveCommentEntryStates(states: LiveCommentEntryState[]) {
  return {
    total: states.length,
    running: states.filter((item) => item.active).length,
    captured: states.filter((item) => item.key === "captured").length,
    failed: states.filter((item) => item.key === "failed" || item.key === "platform_verification" ||
      item.key === "viewer_count_failed" || item.key === "viewer_threshold_exhausted" ||
      item.key === "live_ended_exhausted" || item.key === "live_ended_skip_failed" ||
      item.key === "cleanup_failed").length
  };
}

export function isLiveCommentEntryCaptureCompleted(command: LiveCommentEntryCommandView) {
  const result = command.resultJson ?? {};
  return result.captureCompleted === true ||
    stringValue(result.captureStatus) === "LIVE_COMMENT_ENTRY_CAPTURED" ||
    stringValue(result.status) === "LIVE_COMMENT_ENTRY_CAPTURED";
}

export function isLiveCommentEntryBatchFinished(states: LiveCommentEntryState[]) {
  return states.length > 0 && states.every((item) => !item.active);
}

export function getRestoredLiveCommentEntryWarningIds(
  rows: Array<{ id?: string }>,
  initialBatchId: string,
  activeBatchId: string
) {
  if (!initialBatchId || initialBatchId !== activeBatchId) return [];
  return [...new Set(rows.map((row) => row.id?.trim()).filter((id): id is string => Boolean(id)))];
}

export function readActiveLiveCommentEntryBatchId(storage = browserStorage()) {
  const value = storage?.getItem(activeBatchStorageKey)?.trim() ?? "";
  return isBatchId(value) ? value : "";
}

export function writeActiveLiveCommentEntryBatchId(batchId: string, storage = browserStorage()) {
  if (!storage) return;
  const normalized = batchId.trim();
  if (isBatchId(normalized)) storage.setItem(activeBatchStorageKey, normalized);
  else storage.removeItem(activeBatchStorageKey);
}

export function readLastLiveCommentEntryInput(storage = browserStorage()) {
  const fallback = { targetKeyword: "", minViewerCount: LIVE_COMMENT_ENTRY_DEFAULT_MIN_VIEWERS };
  if (!storage) return fallback;
  try {
    const parsed = JSON.parse(storage.getItem(lastInputStorageKey) ?? "null") as Record<string, unknown> | null;
    if (!parsed) return fallback;
    const targetKeyword = stringValue(parsed.targetKeyword).slice(0, 100);
    return { targetKeyword, minViewerCount: normalizedViewerFloor(parsed.minViewerCount) };
  } catch {
    return fallback;
  }
}

export function writeLastLiveCommentEntryInput(
  input: { targetKeyword: string; minViewerCount?: number | null },
  storage = browserStorage()
) {
  if (!storage) return;
  storage.setItem(lastInputStorageKey, JSON.stringify({
    targetKeyword: input.targetKeyword.trim().slice(0, 100),
    minViewerCount: normalizedViewerFloor(input.minViewerCount)
  }));
}

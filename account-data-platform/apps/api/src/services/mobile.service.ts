import { config } from "../config";
import { parseOptionalDate } from "../lib/date";
import { createHeartbeat } from "../repositories/heartbeat.repository";
import { createRuntimeLog } from "../repositories/log.repository";
import { upsertDeviceLogFile } from "../repositories/log-file.repository";
import { createLiveCommentAction } from "../repositories/live-comment.repository";
import { createCollectionRecord } from "../repositories/record.repository";
import { findCurrentTask, findDeviceTaskConfig, findTaskByCode, resolveTaskConfig } from "../repositories/task.repository";
import { findDeviceByCode, findDeviceByToken, registerDeviceByToken, resolveDeviceByToken } from "../repositories/device.repository";
import type { MobileCollectionRecordPayload, MobileHeartbeatPayload, MobileLiveCommentActionPayload, MobileLogFilePayload, MobileRuntimeLogPayload } from "@pkg/types";

async function resolveMobileDevice(values: {
  deviceId: string;
  deviceToken?: string;
  platform?: string;
  appVersion?: string;
  clientIp?: string;
}) {
  if (!values.deviceToken) {
    throw new Error("DEVICE_TOKEN_REQUIRED");
  }

  return resolveDeviceByToken({
    deviceToken: values.deviceToken,
    platform: values.platform,
    appVersion: values.appVersion,
    lastIp: values.clientIp
  });
}

function isGenericDeviceId(deviceId: string) {
  const normalized = (deviceId || "").trim();
  return !normalized || normalized === "android_001" || normalized === "unknown";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20);
}

function buildFollowedAccounts(
  followedConfigs: Array<{
    config: {
      followedAccountName?: string | null;
      followedAccountId?: string | null;
      followedAliases?: unknown;
    };
    deviceCode?: string | null;
    deviceName?: string | null;
  }>,
  liveCommentConfig: Record<string, unknown>
) {
  const accounts = followedConfigs
    .map((item) => {
      const aliasNames = normalizeStringList(item.config.followedAliases);
      const accountName = (item.config.followedAccountName || item.deviceName || "").trim();
      const accountId = (item.config.followedAccountId || item.deviceCode || "").trim();
      if (!accountName && !accountId && aliasNames.length === 0) {
        return null;
      }
      return { accountName, accountId, aliasNames };
    })
    .filter((item): item is { accountName: string; accountId: string; aliasNames: string[] } => !!item);

  if (accounts.length > 0) {
    return accounts;
  }

  const names = normalizeStringList(liveCommentConfig.leaderAccountNames);
  const ids = normalizeStringList(liveCommentConfig.leaderAccountIds);
  return names.map((accountName, index) => ({
    accountName,
    accountId: ids[index] || "",
    aliasNames: []
  }));
}

export async function getCurrentTask(deviceId: string, platform: string, clientIp?: string, deviceToken?: string) {
  const device = await resolveMobileDevice({ deviceId, deviceToken, platform, clientIp });
  const result = await findDeviceTaskConfig(device.deviceCode, platform);
  const task = result.task ?? (await findCurrentTask(platform));
  const taskConfig = resolveTaskConfig(task, result.config);
  const liveCommentConfig = (taskConfig.liveCommentConfig ?? {}) as Record<string, unknown>;
  const followedAccounts = buildFollowedAccounts(result.followedConfigs ?? [], liveCommentConfig);
  const leaderAccountNames = followedAccounts.flatMap((account) => [account.accountName, ...(account.aliasNames || [])]).filter(Boolean);
  const leaderAccountIds = followedAccounts.map((account) => account.accountId).filter(Boolean);
  const effectiveLiveCommentConfig = {
    ...liveCommentConfig,
    groupName: taskConfig.liveCommentGroup ?? liveCommentConfig.groupName,
    leaderAccountNames,
    leaderAccountIds
  };

  return {
    taskId: task.taskCode,
    templateCode: task.taskCode,
    deviceCode: device.deviceCode,
    platform: task.platform,
    mode: task.mode,
    searchKeywords: task.searchKeywords,
    matchKeywords: task.matchKeywords,
    videoMinutesMin: taskConfig.videoMinutesMin,
    videoMinutesMax: taskConfig.videoMinutesMax,
    liveMinutesMin: taskConfig.liveMinutesMin,
    liveMinutesMax: taskConfig.liveMinutesMax,
    autoStart: taskConfig.autoStart,
    collectComments: taskConfig.collectComments,
    commentLimit: taskConfig.commentLimit,
    liveCommentRole: taskConfig.liveCommentRole,
    liveCommentGroup: taskConfig.liveCommentGroup,
    liveCommentMode: taskConfig.liveCommentMode,
    accountProfile: result.device?.accountProfile ?? null,
    liveCommentBotConfig: taskConfig.liveCommentBotConfig,
    followedAccounts,
    liveCommentConfig: effectiveLiveCommentConfig,
    p3ExtensionsConfig: taskConfig.p3ExtensionsConfig ?? null,
    heartbeatMinutes: taskConfig.heartbeatMinutes,
    configSource: result.config ? "device" : "task"
  };
}

export async function saveCollectionRecord(payload: MobileCollectionRecordPayload, clientIp?: string, deviceToken?: string) {
  const [task, device] = await Promise.all([
    findTaskByCode(payload.taskId),
    resolveMobileDevice({ deviceId: payload.deviceId, deviceToken, platform: payload.platform, clientIp })
  ]);
  return createCollectionRecord({
    tenantId: config.tenantId,
    taskId: task?.id,
    deviceId: device.id,
    platform: payload.platform,
    sceneType: payload.sceneType,
    keyword: payload.keyword,
    matchedKeywords: payload.matchedKeywords,
    authorName: payload.authorName,
    titleText: payload.titleText,
    subtitleText: payload.subtitleText,
    metricsText: payload.metricsText,
    hotCommentsJson: payload.hotComments,
    screenText: payload.screenText,
    rawPayload: payload.rawPayload,
    capturedAt: parseOptionalDate(payload.capturedAt),
    createdBy: "mobile_agent",
    updatedBy: "mobile_agent"
  });
}

export async function saveHeartbeat(payload: MobileHeartbeatPayload, clientIp?: string, deviceToken?: string) {
  const [task, device] = await Promise.all([
    findTaskByCode(payload.taskId),
    resolveMobileDevice({ deviceId: payload.deviceId, deviceToken, appVersion: payload.appVersion, clientIp })
  ]);
  return createHeartbeat({
    tenantId: config.tenantId,
    taskId: task?.id,
    deviceId: device.id,
    status: payload.status,
    sceneType: payload.sceneType,
    elapsedMinutes: payload.elapsedMinutes,
    remainingMinutes: payload.remainingMinutes,
    viewedCount: payload.viewedCount,
    liveViewedCount: payload.liveViewedCount,
    liveRoomEnteredCount: payload.liveRoomEnteredCount,
    liveCandidateCount: payload.liveCandidateCount,
    liveRejectedCount: payload.liveRejectedCount,
    capturedCount: payload.capturedCount,
    lastMessage: payload.lastMessage,
    expectedEndAt: parseOptionalDate(payload.expectedEndAt ?? undefined),
    rawPayload: { ...(payload.rawPayload ?? {}), appVersion: payload.appVersion },
    reportedAt: parseOptionalDate(payload.reportedAt) ?? new Date(),
    createdBy: "mobile_agent",
    updatedBy: "mobile_agent"
  });
}

export async function saveRuntimeLog(payload: MobileRuntimeLogPayload, clientIp?: string, deviceToken?: string) {
  const [task, device] = await Promise.all([
    payload.taskId ? findTaskByCode(payload.taskId) : null,
    resolveMobileDevice({ deviceId: payload.deviceId, deviceToken, clientIp })
  ]);
  return createRuntimeLog({
    tenantId: config.tenantId,
    taskId: task?.id,
    deviceId: device.id,
    level: payload.level,
    message: payload.message,
    contextJson: sanitizeRuntimeContext(payload.context),
    stopReason: payload.stopReason ?? undefined,
    reportedAt: parseOptionalDate(payload.reportedAt),
    createdBy: "mobile_agent",
    updatedBy: "mobile_agent"
  });
}

export async function saveLiveCommentAction(payload: MobileLiveCommentActionPayload, clientIp?: string, deviceToken?: string) {
  const [task, device] = await Promise.all([
    payload.taskId ? findTaskByCode(payload.taskId) : null,
    resolveMobileDevice({ deviceId: payload.deviceId, deviceToken, platform: payload.platform, clientIp })
  ]);

  return createLiveCommentAction({
    tenantId: config.tenantId,
    taskId: task?.id,
    deviceId: device.id,
    triggerEventId: payload.triggerEventId,
    platform: payload.platform,
    roomName: payload.roomName,
    leaderAccountName: payload.leaderAccountName,
    triggerText: payload.triggerText,
    matchedKeywords: payload.matchedKeywords,
    replyText: payload.replyText,
    plannedDelayMs: payload.plannedDelayMs,
    status: payload.status,
    skipReason: payload.skipReason,
    failureReason: payload.failureReason,
    rawPayload: payload.rawPayload,
    plannedAt: parseOptionalDate(payload.plannedAt),
    sentAt: parseOptionalDate(payload.sentAt),
    reportedAt: parseOptionalDate(payload.reportedAt) ?? new Date(),
    createdBy: "mobile_agent",
    updatedBy: "mobile_agent"
  });
}

function sanitizeRuntimeContext(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (depth > 3) {
    return { truncated: true };
  }
  const result: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).slice(0, 40).forEach(([key, item]) => {
    if (typeof item === "string") {
      result[key] = item.length > 800 ? `${item.slice(0, 800)}...` : item;
      return;
    }
    if (typeof item === "number" || typeof item === "boolean" || item === null) {
      result[key] = item;
      return;
    }
    if (Array.isArray(item)) {
      result[key] = item.slice(0, 20).map((entry) => {
        if (typeof entry === "string") return entry.length > 300 ? `${entry.slice(0, 300)}...` : entry;
        if (typeof entry === "number" || typeof entry === "boolean" || entry === null) return entry;
        if (entry && typeof entry === "object") return sanitizeRuntimeContext(entry, depth + 1);
        return String(entry);
      });
      if (item.length > 20) {
        result[`${key}TruncatedCount`] = item.length - 20;
      }
      return;
    }
    if (item && typeof item === "object") {
      result[key] = sanitizeRuntimeContext(item, depth + 1);
      return;
    }
    result[key] = String(item);
  });
  return result;
}

function countMatches(content: string, pattern: RegExp) {
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

function findLastErrorReason(content: string) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.includes("[ERROR]") || line.includes("[WARN]")) {
      return line.slice(0, 500);
    }
  }
  return undefined;
}

export async function saveLogFile(payload: MobileLogFilePayload, clientIp?: string, deviceToken?: string) {
  const [task, device] = await Promise.all([
    payload.taskId ? findTaskByCode(payload.taskId) : null,
    resolveMobileDevice({ deviceId: payload.deviceId, deviceToken, clientIp })
  ]);
  const content = payload.content || "";
  return upsertDeviceLogFile({
    tenantId: config.tenantId,
    taskId: task?.id,
    deviceId: device.id,
    logDate: payload.logDate,
    fileName: payload.fileName,
    content,
    fileSizeBytes: payload.fileSizeBytes ?? content.length,
    infoCount: countMatches(content, /\[INFO\]/g),
    warnCount: countMatches(content, /\[WARN\]/g),
    errorCount: countMatches(content, /\[ERROR\]/g),
    lastErrorReason: findLastErrorReason(content),
    uploadedAt: parseOptionalDate(payload.uploadedAt) ?? new Date(),
    createdBy: "mobile_agent",
    updatedBy: "mobile_agent"
  });
}

export async function registerDeviceToken(payload: {
  deviceId: string;
  deviceToken: string;
  registrationSecret?: string;
  platform?: string;
  appVersion?: string;
  deviceInfo?: Record<string, unknown>;
}, clientIp?: string) {
  if (!payload.deviceToken || payload.deviceToken.length < 32) {
    throw new Error("INVALID_DEVICE_TOKEN");
  }

  const existingDevice = await findDeviceByToken(payload.deviceToken);
  if (!existingDevice && config.mobileRegistrationSecret && payload.registrationSecret !== config.mobileRegistrationSecret) {
    throw new Error("REGISTRATION_SECRET_INVALID");
  }
  if (existingDevice && !isGenericDeviceId(payload.deviceId) && existingDevice.deviceCode !== payload.deviceId) {
    throw new Error("DEVICE_CODE_MISMATCH");
  }
  if (!existingDevice && !isGenericDeviceId(payload.deviceId)) {
    const boundDevice = await findDeviceByCode(payload.deviceId);
    if (boundDevice && boundDevice.deviceToken && boundDevice.deviceToken !== payload.deviceToken) {
      throw new Error("DEVICE_CODE_CONFLICT");
    }
  }

  const device = await registerDeviceByToken({
    deviceToken: payload.deviceToken,
    preferredDeviceCode: isGenericDeviceId(payload.deviceId) ? undefined : payload.deviceId,
    platform: payload.platform,
    appVersion: payload.appVersion,
    lastIp: clientIp
  });

  return {
    deviceCode: device.deviceCode,
    deviceId: device.deviceCode,
    bound: true,
    status: "VERIFIED"
  };
}

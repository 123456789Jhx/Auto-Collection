import { config } from "../config";
import { parseOptionalDate } from "../lib/date";
import { createHeartbeat } from "../repositories/heartbeat.repository";
import { createRuntimeLog } from "../repositories/log.repository";
import { upsertDeviceLogFile } from "../repositories/log-file.repository";
import { createCollectionRecord } from "../repositories/record.repository";
import { findCurrentTask, findDeviceTaskConfig, findTaskByCode } from "../repositories/task.repository";
import { registerDeviceByToken, resolveDeviceByToken } from "../repositories/device.repository";
import type { MobileCollectionRecordPayload, MobileHeartbeatPayload, MobileLogFilePayload, MobileRuntimeLogPayload } from "@pkg/types";

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

export async function getCurrentTask(deviceId: string, platform: string, clientIp?: string, deviceToken?: string) {
  const device = await resolveMobileDevice({ deviceId, deviceToken, platform, clientIp });
  const result = await findDeviceTaskConfig(device.deviceCode, platform);
  const task = result.task ?? (await findCurrentTask(platform));
  const taskConfig = result.config ?? task;
  return {
    taskId: task.taskCode,
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
    rawPayload: payload.rawPayload,
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
  platform?: string;
  appVersion?: string;
  deviceInfo?: Record<string, unknown>;
}, clientIp?: string) {
  if (!payload.deviceToken || payload.deviceToken.length < 32) {
    throw new Error("INVALID_DEVICE_TOKEN");
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
    bound: true,
    status: "VERIFIED"
  };
}

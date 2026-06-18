import { paginationQuerySchema, type UpdateDevicePayload, type UpdateDeviceTaskConfigPayload, type UpdateTaskPayload } from "@pkg/types";
import { randomBytes } from "node:crypto";
import { listDevices, updateDeviceByCode } from "../repositories/device.repository";
import { getDeviceDailyProgressSummaries, listDeviceHeartbeats, listLatestHeartbeats, listLatestHeartbeatsByDeviceIds } from "../repositories/heartbeat.repository";
import { countRuntimeLogs, getLogDateSummaries, getLogDeviceSummaries, listRuntimeLogs } from "../repositories/log.repository";
import { getDeviceLogFile, getLogFileDeviceSummaries, listDeviceLogFileDates, listDeviceLogFiles } from "../repositories/log-file.repository";
import { countCollectionRecords, getRecordDateSummaries, getRecordDeviceSummaries, getSceneCountsSince, listCollectionRecords } from "../repositories/record.repository";
import { findDeviceTaskConfig, listTasks, updateTask, upsertDeviceTaskConfig } from "../repositories/task.repository";
import { createCommand } from "./command.service";
import { listResponse } from "../lib/response";
import { parseOptionalDate } from "../lib/date";

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function minutesSince(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
}

function mapDeviceStatus<T extends { lastHeartbeatAt: Date | string | null; status: string }>(device: T) {
  const heartbeatAgeMinutes = minutesSince(device.lastHeartbeatAt);
  const online = heartbeatAgeMinutes !== null && heartbeatAgeMinutes <= 3;
  const effectiveStatus = online ? device.status : "offline";
  return {
    ...device,
    status: effectiveStatus,
    reportedStatus: device.status,
    heartbeatAgeMinutes,
    effectiveStatus
  };
}

function hideDeviceSecret<T extends { deviceToken?: string | null }>(device: T) {
  const { deviceToken: _deviceToken, ...rest } = device;
  return {
    ...rest,
    hasDeviceToken: !!_deviceToken
  };
}

function numberFromRaw(raw: unknown, key: string) {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export async function getOverview() {
  const todayStart = startOfToday();
  const todayKey = utcDateKey();
  const [devices, todayRecordCount, todaySceneCounts, todayErrorCount, latestHeartbeats] = await Promise.all([
    listDevices(),
    countCollectionRecords({ createdFrom: todayStart }),
    getSceneCountsSince(todayStart),
    countRuntimeLogs({ createdFrom: todayStart, level: "ERROR" }),
    listLatestHeartbeats(50)
  ]);
  const todayProgressRows = await Promise.all(devices.map((device) => getDeviceDailyProgressSummaries(device.deviceCode, 1)));
  const todayProgressByDeviceCode = new Map(devices.map((device, index) => {
    const progress = todayProgressRows[index]?.[0] ?? null;
    return [device.deviceCode, progress?.progressDate === todayKey ? progress : null];
  }));
  const devicesWithStatus = devices.map(mapDeviceStatus);
  const latestHeartbeatByDeviceId = new Map(latestHeartbeats.filter((heartbeat) => heartbeat.deviceId).map((heartbeat) => [heartbeat.deviceId, heartbeat]));
  const deviceProgress = devicesWithStatus.map((device) => {
    const heartbeat = latestHeartbeatByDeviceId.get(device.id);
    const rawPayload = heartbeat?.rawPayload ?? {};
    const todayProgress = todayProgressByDeviceCode.get(device.deviceCode);
    const isActiveHeartbeat = heartbeat?.status === "running";
    const currentTask = isActiveHeartbeat && (heartbeat?.sceneType === "video" || heartbeat?.sceneType === "live") ? heartbeat.sceneType : "none";
    const rawVideoElapsed = isActiveHeartbeat ? numberFromRaw(rawPayload, "videoElapsedMinutes") ?? (heartbeat?.sceneType === "video" ? heartbeat.elapsedMinutes ?? 0 : 0) : 0;
    const rawLiveElapsed = isActiveHeartbeat ? numberFromRaw(rawPayload, "liveElapsedMinutes") ?? (heartbeat?.sceneType === "live" ? heartbeat.elapsedMinutes ?? 0 : 0) : 0;
    const videoElapsed = Math.max(Number(rawVideoElapsed ?? 0), Number(todayProgress?.maxVideoElapsedMinutes ?? 0));
    const liveElapsed = Math.max(Number(rawLiveElapsed ?? 0), Number(todayProgress?.maxLiveElapsedMinutes ?? 0));
    const videoPlanned = isActiveHeartbeat ? numberFromRaw(rawPayload, "plannedVideoMinutes") ?? todayProgress?.maxVideoPlannedMinutes : todayProgress?.maxVideoPlannedMinutes;
    const livePlanned = isActiveHeartbeat ? numberFromRaw(rawPayload, "plannedLiveMinutes") ?? todayProgress?.maxLivePlannedMinutes : todayProgress?.maxLivePlannedMinutes;
    const rawVideoRemaining = isActiveHeartbeat ? numberFromRaw(rawPayload, "videoRemainingMinutes") ?? (heartbeat?.sceneType === "video" ? heartbeat.remainingMinutes ?? null : null) : null;
    const rawLiveRemaining = isActiveHeartbeat ? numberFromRaw(rawPayload, "liveRemainingMinutes") ?? (heartbeat?.sceneType === "live" ? heartbeat.remainingMinutes ?? null : null) : null;
    const videoRemaining = videoPlanned && videoPlanned > 0 ? Math.max(0, Number(videoPlanned) - videoElapsed) : rawVideoRemaining;
    const liveRemaining = livePlanned && livePlanned > 0 ? Math.max(0, Number(livePlanned) - liveElapsed) : rawLiveRemaining;
    return {
      id: device.id,
      deviceCode: device.deviceCode,
      deviceName: device.deviceName,
      status: device.effectiveStatus,
      currentTask,
      videoElapsedMinutes: videoElapsed,
      videoRemainingMinutes: videoRemaining,
      plannedVideoMinutes: videoPlanned,
      liveElapsedMinutes: liveElapsed,
      liveRemainingMinutes: liveRemaining,
      plannedLiveMinutes: livePlanned,
      remainingMinutes: heartbeat?.remainingMinutes ?? null,
      viewedCount: Math.max(isActiveHeartbeat ? Number(heartbeat?.viewedCount ?? 0) : 0, Number(todayProgress?.maxViewedCount ?? 0)),
      liveViewedCount: Math.max(isActiveHeartbeat ? Number(heartbeat?.liveViewedCount ?? 0) : 0, Number(todayProgress?.maxLiveViewedCount ?? 0)),
      capturedCount: Math.max(isActiveHeartbeat ? Number(heartbeat?.capturedCount ?? 0) : 0, Number(todayProgress?.maxCapturedCount ?? 0)),
      lastHeartbeatAt: heartbeat?.reportedAt ?? device.lastHeartbeatAt,
      heartbeat
    };
  });
  return {
    deviceCount: devices.length,
    runningCount: devicesWithStatus.filter((item) => item.effectiveStatus === "running" || item.effectiveStatus === "online").length,
    pausedCount: devicesWithStatus.filter((item) => item.effectiveStatus === "paused").length,
    offlineCount: devicesWithStatus.filter((item) => item.effectiveStatus === "offline").length,
    todayRecordCount,
    todayVideoRecordCount: todaySceneCounts.video,
    todayLiveRecordCount: todaySceneCounts.live,
    todayErrorCount,
    deviceProgress
  };
}

export async function getDevices() {
  const devices = await listDevices();
  const heartbeats = await listLatestHeartbeatsByDeviceIds(devices.map((device) => device.id));
  const heartbeatByDeviceId = new Map(heartbeats.map((heartbeat) => [heartbeat.deviceId, heartbeat]));
  return devices.map((device) => {
    const latestHeartbeat = heartbeatByDeviceId.get(device.id);
    const deviceStatus = mapDeviceStatus(device);
    const activeTask = latestHeartbeat?.status === "running" && (latestHeartbeat.sceneType === "video" || latestHeartbeat.sceneType === "live");
    return hideDeviceSecret({
      ...deviceStatus,
      currentTask: activeTask ? latestHeartbeat.sceneType : "none",
      latestHeartbeat
    });
  });
}

export async function getDeviceProgressHistory(deviceCode: string, rawQuery: unknown) {
  const raw = (rawQuery ?? {}) as Record<string, string | undefined>;
  const requestedLimit = Number(raw.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 50;
  return listDeviceHeartbeats(deviceCode, limit);
}

export async function getDeviceDailyProgress(deviceCode: string, rawQuery: unknown) {
  const raw = (rawQuery ?? {}) as Record<string, string | undefined>;
  const requestedLimit = Number(raw.limit ?? 30);
  const limit = Number.isFinite(requestedLimit) ? Math.min(90, Math.max(1, requestedLimit)) : 30;
  return getDeviceDailyProgressSummaries(deviceCode, limit);
}

export async function updateDevice(deviceCode: string, payload: UpdateDevicePayload) {
  const updated = await updateDeviceByCode(deviceCode, payload);
  if (!updated) {
    throw new Error("设备不存在");
  }
  return hideDeviceSecret(mapDeviceStatus(updated));
}

export async function rotateDeviceToken(deviceCode: string) {
  const token = randomBytes(24).toString("hex");
  const updated = await updateDeviceByCode(deviceCode, { deviceToken: token });
  if (!updated) {
    throw new Error("设备不存在");
  }
  return {
    deviceCode: updated.deviceCode,
    deviceToken: token
  };
}

export async function clearDeviceToken(deviceCode: string) {
  const updated = await updateDeviceByCode(deviceCode, { deviceToken: null });
  if (!updated) {
    throw new Error("设备不存在");
  }
  return hideDeviceSecret(mapDeviceStatus(updated));
}

export async function getRecords(rawQuery: unknown) {
  const query = paginationQuerySchema.parse(rawQuery);
  const raw = (rawQuery ?? {}) as Record<string, string | undefined>;
  const result = await listCollectionRecords(query.page, query.pageSize, {
    deviceCode: raw.deviceCode,
    sceneType: raw.sceneType,
    keyword: query.keyword,
    createdFrom: parseOptionalDate(query.createdFrom) ?? undefined,
    createdTo: parseOptionalDate(query.createdTo) ?? undefined
  });
  return listResponse(result.data, query.page, query.pageSize, result.totalItems);
}

export async function getRecordDeviceSummary(rawQuery: unknown) {
  const raw = (rawQuery ?? {}) as Record<string, string | undefined>;
  const createdFrom = parseOptionalDate(raw.createdFrom) ?? new Date(0);
  const [devices, summaries] = await Promise.all([listDevices(), getRecordDeviceSummaries(createdFrom)]);
  const summaryByDeviceCode = new Map(summaries.map((summary) => [summary.deviceCode, summary]));
  return devices.map((device) => {
    const summary = summaryByDeviceCode.get(device.deviceCode);
    return {
      deviceId: device.id,
      deviceCode: device.deviceCode,
      deviceName: device.deviceName,
      totalCount: summary?.totalCount ?? 0,
      videoCount: summary?.videoCount ?? 0,
      liveCount: summary?.liveCount ?? 0,
      latestRecordAt: summary?.latestRecordAt ?? null,
      deviceStatus: mapDeviceStatus(device).effectiveStatus,
      lastHeartbeatAt: device.lastHeartbeatAt
    };
  });
}

export async function getRecordDates(deviceCode: string) {
  return getRecordDateSummaries(deviceCode);
}

export async function getLogs(rawQuery: unknown) {
  const query = paginationQuerySchema.parse(rawQuery);
  const raw = (rawQuery ?? {}) as Record<string, string | undefined>;
  const result = await listRuntimeLogs(query.page, query.pageSize, {
    deviceCode: raw.deviceCode,
    level: raw.level,
    keyword: query.keyword,
    createdFrom: parseOptionalDate(query.createdFrom) ?? undefined,
    createdTo: parseOptionalDate(query.createdTo) ?? undefined
  });
  return listResponse(result.data, query.page, query.pageSize, result.totalItems);
}

export async function getLogDeviceSummary(rawQuery: unknown) {
  const raw = (rawQuery ?? {}) as Record<string, string | undefined>;
  const createdFrom = parseOptionalDate(raw.createdFrom) ?? new Date(0);
  const [devices, logSummaries, fileSummaries] = await Promise.all([
    listDevices(),
    getLogDeviceSummaries(createdFrom),
    getLogFileDeviceSummaries(createdFrom)
  ]);
  const logsByDeviceCode = new Map(logSummaries.map((summary) => [summary.deviceCode, summary]));
  const filesByDeviceCode = new Map(fileSummaries.map((summary) => [summary.deviceCode, summary]));
  return devices.map((device) => {
    const logSummary = logsByDeviceCode.get(device.deviceCode);
    const fileSummary = filesByDeviceCode.get(device.deviceCode);
    return {
      deviceId: device.id,
      deviceCode: device.deviceCode,
      deviceName: device.deviceName,
      totalCount: logSummary?.totalCount ?? 0,
      infoCount: logSummary?.infoCount ?? 0,
      warnCount: logSummary?.warnCount ?? 0,
      errorCount: logSummary?.errorCount ?? 0,
      fileCount: fileSummary?.fileCount ?? 0,
      fileSizeBytes: fileSummary?.fileSizeBytes ?? 0,
      latestLogAt: logSummary?.latestLogAt ?? fileSummary?.latestUploadedAt ?? fileSummary?.latestCreatedAt ?? null,
      latestFileUploadedAt: fileSummary?.latestUploadedAt ?? null,
      deviceStatus: mapDeviceStatus(device).effectiveStatus,
      lastHeartbeatAt: device.lastHeartbeatAt
    };
  });
}

export async function getLogDates(deviceCode: string) {
  const [logDates, fileDates] = await Promise.all([getLogDateSummaries(deviceCode), listDeviceLogFileDates(deviceCode)]);
  const byDate = new Map<string, Record<string, unknown>>();
  logDates.forEach((item) => {
    byDate.set(item.logDate, {
      ...item,
      fileCount: 0,
      fileSizeBytes: 0,
      latestUploadedAt: null
    });
  });
  fileDates.forEach((item) => {
    const existing = byDate.get(item.logDate) ?? {
      logDate: item.logDate,
      totalCount: 0,
      infoCount: 0,
      warnCount: 0,
      errorCount: 0,
      latestLogAt: null
    };
    byDate.set(item.logDate, {
      ...existing,
      fileCount: Number(item.fileCount ?? 0),
      fileSizeBytes: Number(item.fileSizeBytes ?? 0),
      latestUploadedAt: item.latestUploadedAt,
      latestLogAt: existing.latestLogAt ?? item.latestUploadedAt
    });
  });
  return Array.from(byDate.values()).sort((left, right) => String(right.logDate).localeCompare(String(left.logDate)));
}

export async function getLogFileDates(deviceCode: string) {
  return listDeviceLogFileDates(deviceCode);
}

export async function getLogFiles(rawQuery: unknown) {
  const raw = (rawQuery ?? {}) as Record<string, string | undefined>;
  return listDeviceLogFiles({
    deviceCode: raw.deviceCode,
    logDate: raw.logDate,
    createdFrom: parseOptionalDate(raw.createdFrom) ?? undefined
  });
}

export async function getLogFileDetail(fileId: string) {
  const file = await getDeviceLogFile(fileId);
  if (!file) {
    throw new Error("日志文件不存在");
  }
  return file;
}

export async function getTasks() {
  return listTasks();
}

export async function updateTaskConfig(taskId: string, payload: UpdateTaskPayload) {
  const updated = await updateTask(taskId, payload);
  if (!updated) {
    throw new Error("任务不存在");
  }
  return updated;
}

export async function getDeviceTaskConfig(deviceCode: string, platform = "douyin") {
  const result = await findDeviceTaskConfig(deviceCode, platform);
  const source = result.config ?? result.task;
  return {
    deviceCode,
    platform: result.task.platform,
    taskId: result.task.id,
    taskCode: result.task.taskCode,
    source: result.config ? "device" : "task",
    videoMinutesMin: source.videoMinutesMin,
    videoMinutesMax: source.videoMinutesMax,
    liveMinutesMin: source.liveMinutesMin,
    liveMinutesMax: source.liveMinutesMax,
    autoStart: source.autoStart,
    collectComments: source.collectComments,
    commentLimit: source.commentLimit,
    heartbeatMinutes: source.heartbeatMinutes
  };
}

export async function updateDeviceTaskConfig(deviceCode: string, payload: UpdateDeviceTaskConfigPayload, platform = "douyin") {
  const result = await upsertDeviceTaskConfig(deviceCode, platform, payload);
  if (!result?.config) {
    throw new Error("设备不存在");
  }
  await createCommand({
    deviceId: deviceCode,
    commandType: "REFRESH_CONFIG",
    payload: {
      reason: "device_task_config_updated",
      platform
    },
    expiresInSeconds: 3600
  });
  return getDeviceTaskConfig(deviceCode, platform);
}

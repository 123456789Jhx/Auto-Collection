import { collectorDevices, mobileCommands, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export function listEnabledPublishVideoConfigs() {
  return db.select().from(remoteScriptConfigs).where(and(
    eq(remoteScriptConfigs.tenantId, config.tenantId),
    eq(remoteScriptConfigs.scriptKey, "publish_video"),
    eq(remoteScriptConfigs.status, "ENABLED"),
    isNull(remoteScriptConfigs.deletedAt)
  )).orderBy(asc(remoteScriptConfigs.createdAt));
}

export async function hasPublishTaskForSlot(configId: string, slot: Date) {
  const [row] = await db.select({ total: count() }).from(publishTasks).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.configId, configId),
    eq(publishTasks.scheduledSlot, slot),
    isNull(publishTasks.deletedAt)
  ));
  return Number(row?.total ?? 0) > 0;
}

export async function savePublishTaskDispatched(id: string, scheduledSlot: Date, actor: string) {
  const now = new Date();
  const [task] = await db.update(publishTasks).set({
    status: "DISPATCHED",
    scheduledSlot,
    dispatchedAt: now,
    resultError: null,
    failureCode: null,
    dispatchRetryCount: 0,
    nextDispatchAt: null,
    lastDispatchAttemptAt: now,
    updatedAt: now,
    updatedBy: actor
  }).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.id, id),
    isNull(publishTasks.deletedAt)
  )).returning();
  if (!task) throw new Error("PUBLISH_TASK_NOT_FOUND");
  return task;
}

export async function savePublishTaskResult(
  id: string,
  values: {
    status: string;
    resultError?: string | null;
    publishedUrl?: string | null;
    platformContentId?: string | null;
    scheduledSlot?: Date;
    finishedAt?: Date;
    reportedAt?: Date | null;
    reportStatus?: string;
    reportLastError?: string | null;
    reportAttempts?: number;
  },
  actor: string
) {
  const [task] = await db.update(publishTasks).set({
    ...values,
    updatedAt: new Date(),
    updatedBy: actor
  }).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.id, id),
    isNull(publishTasks.deletedAt)
  )).returning();
  if (!task) throw new Error("PUBLISH_TASK_NOT_FOUND");
  return task;
}

export function listDuePublishBusyTasks(now = new Date()) {
  return db.select().from(publishTasks).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.status, "PUBLISH_BUSY"),
    lte(publishTasks.nextDispatchAt, now),
    isNull(publishTasks.deletedAt)
  )).orderBy(asc(publishTasks.nextDispatchAt));
}

export async function hasActivePublishForDevice(deviceId: string, excludeTaskId?: string) {
  const now = new Date();
  const commandConditions = [
    eq(mobileCommands.tenantId, config.tenantId),
    eq(mobileCommands.deviceId, deviceId),
    eq(mobileCommands.commandType, "PUBLISH_VIDEO_TASK"),
    inArray(mobileCommands.status, ["PENDING", "FETCHED"]),
    gt(mobileCommands.expiresAt, now),
    isNull(mobileCommands.deletedAt)
  ];
  if (excludeTaskId) {
    commandConditions.push(ne(mobileCommands.idempotencyKey, `${excludeTaskId}:${deviceId}`));
  }
  const [command] = await db.select({ id: mobileCommands.id }).from(mobileCommands)
    .where(and(...commandConditions)).limit(1);
  if (command) return true;

  const conditions = [
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.matchedDeviceId, deviceId),
    inArray(publishTasks.status, ["DISPATCHED", "RUNNING", "TOPIC_PENDING"]),
    isNull(publishTasks.deletedAt)
  ];
  if (excludeTaskId) conditions.push(ne(publishTasks.id, excludeTaskId));
  const [task] = await db.select({ id: publishTasks.id }).from(publishTasks).where(and(...conditions)).limit(1);
  return Boolean(task);
}

export async function savePublishTaskBusy(
  id: string,
  retryCount: number,
  nextDispatchAt: Date,
  actor: string
) {
  const now = new Date();
  const [task] = await db.update(publishTasks).set({
    status: "PUBLISH_BUSY",
    failureCode: "PUBLISH_BUSY",
    dispatchRetryCount: retryCount,
    nextDispatchAt,
    lastDispatchAttemptAt: now,
    resultError: "PUBLISH_BUSY",
    updatedAt: now,
    updatedBy: actor
  }).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.id, id),
    isNull(publishTasks.deletedAt)
  )).returning();
  if (!task) throw new Error("PUBLISH_TASK_NOT_FOUND");
  return task;
}

export async function findPublishTaskContext(id: string) {
  const taskIdCondition = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? or(eq(publishTasks.id, id), eq(publishTasks.taskId, id))
    : eq(publishTasks.taskId, id);
  const [row] = await db.select({
    task: publishTasks,
    configPayload: remoteScriptConfigs.configPayload,
    deviceCode: collectorDevices.deviceCode
  }).from(publishTasks)
    .innerJoin(remoteScriptConfigs, eq(publishTasks.configId, remoteScriptConfigs.id))
    .leftJoin(collectorDevices, eq(publishTasks.matchedDeviceId, collectorDevices.id))
    .where(and(
      eq(publishTasks.tenantId, config.tenantId),
      taskIdCondition,
      isNull(publishTasks.deletedAt),
      isNull(remoteScriptConfigs.deletedAt)
    )).limit(1);
  return row ?? null;
}

export async function updatePublishTaskDescription(
  id: string,
  description: string,
  status: "CLAIMED" | "MATCHED",
  actor: string
) {
  const [task] = await db.update(publishTasks).set({
    description,
    status,
    matchNote: null,
    resultError: null,
    finishedAt: null,
    reportedAt: null,
    updatedAt: new Date(),
    updatedBy: actor
  }).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.id, id),
    eq(publishTasks.status, "TOPIC_PENDING"),
    isNull(publishTasks.deletedAt)
  )).returning();
  return task ?? null;
}

function dashboardExpectedTopicCount(configPayload: unknown) {
  const value = (configPayload as { expectedTopicCount?: unknown } | null)?.expectedTopicCount;
  const expected = Math.trunc(Number(value));
  return Number.isFinite(expected) && expected > 0 ? expected : 5;
}

export async function getPublishTaskDashboard(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const rows = await db.select({
    id: publishTasks.id,
    configPayload: remoteScriptConfigs.configPayload,
    taskId: publishTasks.taskId,
    title: publishTasks.title,
    description: publishTasks.description,
    accountName: publishTasks.accountName,
    deviceCode: collectorDevices.deviceCode,
    platform: publishTasks.platform,
    status: publishTasks.status,
    source: publishTasks.source,
    mode: publishTasks.mode,
    reportMode: publishTasks.reportMode,
    reportStatus: publishTasks.reportStatus,
    reportAttempts: publishTasks.reportAttempts,
    reportLastError: publishTasks.reportLastError,
    scheduledAt: publishTasks.scheduledAt,
    scheduledSlot: publishTasks.scheduledSlot,
    resultError: publishTasks.resultError,
    failureCode: publishTasks.failureCode,
    dispatchRetryCount: publishTasks.dispatchRetryCount,
    nextDispatchAt: publishTasks.nextDispatchAt,
    lastDispatchAttemptAt: publishTasks.lastDispatchAttemptAt,
    matchNote: publishTasks.matchNote,
    publishedUrl: publishTasks.publishedUrl,
    claimedAt: publishTasks.claimedAt,
    dispatchedAt: publishTasks.dispatchedAt,
    finishedAt: publishTasks.finishedAt,
    reportedAt: publishTasks.reportedAt,
    updatedAt: publishTasks.updatedAt
  }).from(publishTasks)
    .leftJoin(remoteScriptConfigs, eq(publishTasks.configId, remoteScriptConfigs.id))
    .leftJoin(collectorDevices, eq(publishTasks.matchedDeviceId, collectorDevices.id))
    .where(and(eq(publishTasks.tenantId, config.tenantId), isNull(publishTasks.deletedAt)))
    .orderBy(desc(publishTasks.claimedAt))
    .limit(200);

  const [dailyStats] = await db.select({
    success: sql<number>`count(*) filter (where ${publishTasks.status} = 'REPORTED' and ${publishTasks.resultError} is null and ${publishTasks.matchedDeviceId} is not null)::int`,
    unpublished: sql<number>`count(*) filter (where ${publishTasks.status} = 'REPORTED' and ${publishTasks.resultError} is not null)::int`,
    unmatched: sql<number>`count(*) filter (where ${publishTasks.status} = 'REPORTED' and ${publishTasks.matchedDeviceId} is null)::int`
  }).from(publishTasks).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    gte(publishTasks.reportedAt, start),
    lt(publishTasks.reportedAt, end),
    isNull(publishTasks.deletedAt)
  ));
  const [stateStats] = await db.select({
    busy: sql<number>`count(*) filter (where ${publishTasks.status} = 'PUBLISH_BUSY')::int`,
    topicPending: sql<number>`count(*) filter (where ${publishTasks.status} = 'TOPIC_PENDING')::int`,
    materialInvalid: sql<number>`count(*) filter (where ${publishTasks.status} = 'MATERIAL_INVALID' or ${publishTasks.failureCode} in ('MATERIAL_INVALID', 'VIDEO_REQUIRED', 'COVER_REQUIRED', 'VIDEO_URL_INVALID', 'COVER_URL_INVALID'))::int`,
    channelsVerifyPending: sql<number>`count(*) filter (where ${publishTasks.status} = 'CHANNELS_VERIFY_PENDING')::int`,
    reportFailed: sql<number>`count(*) filter (where ${publishTasks.reportStatus} = 'REPORT_FAILED')::int`
  }).from(publishTasks).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    isNull(publishTasks.deletedAt)
  ));
  const data = rows.map(({ configPayload, ...task }) => ({
    ...task,
    expectedTopicCount: dashboardExpectedTopicCount(configPayload)
  }));
  return {
    data,
    stats: {
      success: dailyStats?.success ?? 0,
      unpublished: dailyStats?.unpublished ?? 0,
      unmatched: dailyStats?.unmatched ?? 0,
      busy: stateStats?.busy ?? 0,
      topicPending: stateStats?.topicPending ?? 0,
      materialInvalid: stateStats?.materialInvalid ?? 0,
      channelsVerifyPending: stateStats?.channelsVerifyPending ?? 0,
      reportFailed: stateStats?.reportFailed ?? 0
    }
  };
}

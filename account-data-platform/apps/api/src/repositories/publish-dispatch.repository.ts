import { collectorDevices, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import { and, asc, count, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
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

export async function findPublishTaskContext(id: string) {
  const [row] = await db.select({
    task: publishTasks,
    configPayload: remoteScriptConfigs.configPayload,
    deviceCode: collectorDevices.deviceCode
  }).from(publishTasks)
    .innerJoin(remoteScriptConfigs, eq(publishTasks.configId, remoteScriptConfigs.id))
    .leftJoin(collectorDevices, eq(publishTasks.matchedDeviceId, collectorDevices.id))
    .where(and(
      eq(publishTasks.tenantId, config.tenantId),
      eq(publishTasks.id, id),
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

export async function getPublishTaskDashboard(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const data = await db.select({
    id: publishTasks.id,
    taskId: publishTasks.taskId,
    title: publishTasks.title,
    description: publishTasks.description,
    accountName: publishTasks.accountName,
    deviceCode: collectorDevices.deviceCode,
    platform: publishTasks.platform,
    status: publishTasks.status,
    scheduledSlot: publishTasks.scheduledSlot,
    resultError: publishTasks.resultError,
    matchNote: publishTasks.matchNote,
    publishedUrl: publishTasks.publishedUrl,
    claimedAt: publishTasks.claimedAt,
    dispatchedAt: publishTasks.dispatchedAt,
    finishedAt: publishTasks.finishedAt,
    reportedAt: publishTasks.reportedAt,
    updatedAt: publishTasks.updatedAt
  }).from(publishTasks)
    .leftJoin(collectorDevices, eq(publishTasks.matchedDeviceId, collectorDevices.id))
    .where(and(eq(publishTasks.tenantId, config.tenantId), isNull(publishTasks.deletedAt)))
    .orderBy(desc(publishTasks.claimedAt))
    .limit(200);

  const [stats] = await db.select({
    success: sql<number>`count(*) filter (where ${publishTasks.status} = 'REPORTED' and ${publishTasks.resultError} is null and ${publishTasks.matchedDeviceId} is not null)::int`,
    unpublished: sql<number>`count(*) filter (where ${publishTasks.status} = 'REPORTED' and ${publishTasks.resultError} is not null)::int`,
    unmatched: sql<number>`count(*) filter (where ${publishTasks.status} = 'REPORTED' and ${publishTasks.matchedDeviceId} is null)::int`
  }).from(publishTasks).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    gte(publishTasks.reportedAt, start),
    lt(publishTasks.reportedAt, end),
    isNull(publishTasks.deletedAt)
  ));
  return { data, stats: stats ?? { success: 0, unpublished: 0, unmatched: 0 } };
}

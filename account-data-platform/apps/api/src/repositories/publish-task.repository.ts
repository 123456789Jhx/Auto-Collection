import { collectorDevices, publishTasks } from "@pkg/db/schema";
import type { ClaimedWecomPublishTask, ManualPublishTestPayload, PublishMaterialFailureCode, PublishPlatform } from "@pkg/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

type PublishTaskDatabase = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type SaveClaimedTaskInput = {
  configId: string;
  platform: PublishPlatform;
  task: ClaimedWecomPublishTask;
};

type SaveExternalClaimedTaskInput = {
  configId: string;
  platform: PublishPlatform;
  taskId: string;
  accountName: string;
  title: string;
  description: string;
  videoUrl: string;
  coverUrl: string | null;
  matchedDeviceId: string;
  rawPayload: Record<string, unknown>;
};

// The prefix keeps generated manual IDs out of the external-task unique-key namespace.
export const MANUAL_PUBLISH_TASK_ID_PREFIX = "manual-";

export async function saveManualPublishTaskDispatched(
  input: Omit<ManualPublishTestPayload, "platform"> & { platform: PublishPlatform },
  actor: string,
  database: PublishTaskDatabase = db
) {
  const now = new Date();
  const [task] = await database.insert(publishTasks).values({
    tenantId: config.tenantId,
    configId: input.configId,
    taskId: `${MANUAL_PUBLISH_TASK_ID_PREFIX}${crypto.randomUUID()}`,
    platform: input.platform,
    accountName: "",
    title: input.title,
    description: input.description,
    coverUrl: input.coverUrl,
    videoUrl: input.videoUrl,
    status: "DISPATCHED",
    source: input.source ?? "MANUAL_TEST",
    mode: "IMMEDIATE",
    reportMode: "NONE",
    reportStatus: "NOT_REQUIRED",
    matchedDeviceId: input.deviceId,
    dispatchedAt: now,
    createdBy: actor,
    updatedBy: actor
  }).returning();
  if (!task) throw new Error("PUBLISH_TASK_CREATE_FAILED");
  return task;
}

export async function savePublishTaskMaterialInvalid(
  id: string,
  failureCode: PublishMaterialFailureCode,
  actor: string,
  report: {
    status: "REPORTED" | "FAILED";
    reportStatus: "REPORTED" | "REPORT_FAILED";
    reportLastError?: string | null;
  }
) {
  const now = new Date();
  const [task] = await db.update(publishTasks).set({
    status: report.status,
    failureCode,
    resultError: failureCode,
    finishedAt: now,
    reportedAt: report.status === "REPORTED" ? now : null,
    reportStatus: report.reportStatus,
    reportLastError: report.reportLastError ?? null,
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

export async function findPublishTaskByExternalKey(platform: PublishPlatform, taskId: string) {
  const [task] = await db
    .select()
    .from(publishTasks)
    .where(and(
      eq(publishTasks.tenantId, config.tenantId),
      eq(publishTasks.platform, platform),
      eq(publishTasks.taskId, taskId),
      isNull(publishTasks.deletedAt)
    ))
    .limit(1);
  return task ?? null;
}

export async function saveClaimedPublishTask(input: SaveClaimedTaskInput, actor: string) {
  const [created] = await db
    .insert(publishTasks)
    .values({
      tenantId: config.tenantId,
      configId: input.configId,
      taskId: input.task.taskId,
      platform: input.platform,
      accountName: input.task.accountName ?? "",
      title: input.task.title,
      description: input.task.description,
      coverUrl: input.task.coverUrl?.trim() || null,
      videoUrl: input.task.videoUrl?.trim() || "",
      status: "CLAIMED",
      createdBy: actor,
      updatedBy: actor
    })
    .onConflictDoNothing({
      target: [publishTasks.tenantId, publishTasks.platform, publishTasks.taskId]
    })
    .returning();
  if (created) {
    return { task: created, created: true };
  }
  const existing = await findPublishTaskByExternalKey(input.platform, input.task.taskId);
  if (!existing) {
    throw new Error("发布任务幂等查询失败");
  }
  return { task: existing, created: false };
}

export async function saveExternalClaimedPublishTask(input: SaveExternalClaimedTaskInput, actor: string) {
  const [created] = await db.insert(publishTasks).values({
    tenantId: config.tenantId,
    configId: input.configId,
    taskId: input.taskId,
    platform: input.platform,
    accountName: input.accountName,
    title: input.title,
    description: input.description,
    coverUrl: input.coverUrl,
    videoUrl: input.videoUrl,
    status: "CLAIMED",
    source: "EXTERNAL_CLAIM",
    reportMode: "EXTERNAL",
    matchedDeviceId: input.matchedDeviceId,
    rawPayload: input.rawPayload,
    createdBy: actor,
    updatedBy: actor
  }).onConflictDoNothing({
    target: [publishTasks.tenantId, publishTasks.platform, publishTasks.taskId]
  }).returning();
  if (created) return { task: created, created: true };
  const task = await findPublishTaskByExternalKey(input.platform, input.taskId);
  if (!task) throw new Error("PUBLISH_TASK_IDEMPOTENCY_LOOKUP_FAILED");
  return { task, created: false };
}

export async function findEnabledDeviceByDouyinAccountName(accountName: string) {
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(
      eq(collectorDevices.tenantId, config.tenantId),
      eq(collectorDevices.enabled, true),
      isNull(collectorDevices.deletedAt),
      sql`${collectorDevices.accountProfile}->>'douyinAccountName' = ${accountName}`
    ))
    .limit(1);
  return device ?? null;
}

export async function savePublishTaskMatch(
  id: string,
  match: { matchedDeviceId: string; matchNote?: null } | { matchedDeviceId: null; matchNote: string },
  actor: string
) {
  const [updated] = await db
    .update(publishTasks)
    .set({
      status: match.matchedDeviceId ? "MATCHED" : "UNMATCHED",
      matchedDeviceId: match.matchedDeviceId,
      matchNote: match.matchNote ?? null,
      updatedAt: new Date(),
      updatedBy: actor
    })
    .where(and(
      eq(publishTasks.tenantId, config.tenantId),
      eq(publishTasks.id, id),
      isNull(publishTasks.deletedAt)
    ))
    .returning();
  if (!updated) {
    throw new Error("发布任务匹配结果保存失败");
  }
  return updated;
}

export async function savePublishTaskTopicPending(id: string, reason: string, actor: string) {
  const [updated] = await db.update(publishTasks).set({
    status: "TOPIC_PENDING",
    matchedDeviceId: null,
    matchNote: reason,
    updatedAt: new Date(),
    updatedBy: actor
  }).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.id, id),
    isNull(publishTasks.deletedAt)
  )).returning();
  if (!updated) throw new Error("发布任务话题状态保存失败");
  return updated;
}

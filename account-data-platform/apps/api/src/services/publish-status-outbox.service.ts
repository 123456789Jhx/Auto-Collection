import * as schema from "@pkg/db/schema";
import type { PatchPublishTaskStatusPayload } from "@pkg/types";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../repositories/db";
import { findPublishTaskContext } from "../repositories/publish-dispatch.repository";
import { publishClientOnlyConfigSchema } from "./publish-config";
import { patchTaskStatus, type WecomPublishClientConfig } from "./wecom-publish-client";

const CLAIMABLE_OUTBOX_STATUSES = ["PENDING", "REPORT_PENDING", "RETRY_WAIT"];
const RETRY_DELAYS_MS = [60_000, 3 * 60_000, 10 * 60_000, 30 * 60_000] as const;

type PublishTaskContext = NonNullable<Awaited<ReturnType<typeof findPublishTaskContext>>>;

export type PublishStatusOutboxEntry = {
  id: string;
  publishTaskId: string;
  attempts: number;
  targetStatus: "已发布" | "未发布";
  payload: PatchPublishTaskStatusPayload;
};

export type PublishStatusOutboxSnapshot = {
  publishTaskId: string;
  targetStatus: "已发布" | "未发布";
  payload: PatchPublishTaskStatusPayload;
};

export type PublishStatusOutboxPatch = {
  clientConfig: WecomPublishClientConfig;
  externalTaskId: string;
  payload: PatchPublishTaskStatusPayload;
};

export type PublishStatusOutboxRepository = {
  enqueue: (snapshot: PublishStatusOutboxSnapshot, actor: string, now: Date) => Promise<unknown>;
  claimReady: (now: Date, actor: string) => Promise<PublishStatusOutboxEntry | null>;
  markReported: (entry: PublishStatusOutboxEntry, actor: string, now: Date) => Promise<unknown>;
  markRetry: (entry: PublishStatusOutboxEntry, error: string, actor: string, now: Date) => Promise<unknown>;
  markManualReview: (entry: PublishStatusOutboxEntry, error: string, actor: string, now: Date) => Promise<unknown>;
};

export function nextPublishStatusRetryAt(attempts: number, failedAt: Date) {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, attempts - 1));
  return new Date(failedAt.getTime() + RETRY_DELAYS_MS[index]);
}

export function isPublishStatusOutboxReady(
  entry: { status: string; nextRetryAt: Date | null },
  now: Date
) {
  return CLAIMABLE_OUTBOX_STATUSES.includes(entry.status)
    && (!entry.nextRetryAt || entry.nextRetryAt.getTime() <= now.getTime());
}

function outboxTable() {
  const table = schema.publishStatusOutbox;
  if (!table) throw new Error("PUBLISH_STATUS_OUTBOX_SCHEMA_UNAVAILABLE");
  return table;
}

function publishTaskValues(values: Record<string, unknown>) {
  return values as never;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 2000);
  return "外部状态回写失败";
}

function externalPlatform(platform: string) {
  return platform === "WECHAT_CHANNELS" ? "视频号" as const : "抖音" as const;
}

async function buildPatch(
  context: PublishTaskContext,
  entry: PublishStatusOutboxEntry
): Promise<PublishStatusOutboxPatch> {
  const task = context.task;
  return {
    clientConfig: publishClientOnlyConfigSchema.parse(context.configPayload),
    externalTaskId: task.taskId,
    payload: entry.payload
  };
}

function snapshotFromContext(context: PublishTaskContext): PublishStatusOutboxSnapshot {
  const task = context.task;
  const published = task.localResultStatus === "PUBLISHED" || task.status === "SUCCEEDED";
  const targetStatus = published ? "已发布" as const : "未发布" as const;
  return {
    publishTaskId: task.id,
    targetStatus,
    payload: {
      platform: externalPlatform(task.platform),
      status: targetStatus,
      ...(task.resultError ? { error: task.resultError } : {}),
      ...(task.publishedUrl ? { publishedUrl: task.publishedUrl } : {}),
      ...(task.platformContentId ? { platformContentId: task.platformContentId } : {})
    }
  };
}

const databaseRepository: PublishStatusOutboxRepository = {
  async enqueue(snapshot, actor, now) {
    const outbox = outboxTable();
    const [record] = await db.insert(outbox).values({
      tenantId: config.tenantId,
      publishTaskId: snapshot.publishTaskId,
      status: "PENDING",
      attempts: 0,
      lastError: null,
      lastAttemptedAt: null,
      reportedAt: null,
      targetStatus: snapshot.targetStatus,
      payloadJson: snapshot.payload,
      nextRetryAt: now
    }).onConflictDoNothing({
      target: [outbox.tenantId, outbox.publishTaskId]
    }).returning();
    await db.update(schema.publishTasks).set(publishTaskValues({
      reportStatus: "REPORT_PENDING",
      reportAttempts: 0,
      reportLastError: null,
      updatedAt: now,
      updatedBy: actor
    })).where(and(
      eq(schema.publishTasks.tenantId, config.tenantId),
      eq(schema.publishTasks.id, snapshot.publishTaskId),
      isNull(schema.publishTasks.deletedAt)
    ));
    return record;
  },

  async claimReady(now) {
    const outbox = outboxTable();
    const rows = await db.select().from(outbox).where(and(
      eq(outbox.tenantId, config.tenantId),
      inArray(outbox.status, CLAIMABLE_OUTBOX_STATUSES),
      or(isNull(outbox.nextRetryAt), lte(outbox.nextRetryAt, now))
    )).orderBy(outbox.createdAt).limit(10);

    for (const row of rows) {
      const [claimed] = await db.update(outbox).set({
        status: "REPORTING",
        attempts: sql`${outbox.attempts} + 1`,
        lastError: null,
        lastAttemptedAt: now,
        updatedAt: now
      }).where(and(
        eq(outbox.tenantId, config.tenantId),
        eq(outbox.id, row.id),
        inArray(outbox.status, CLAIMABLE_OUTBOX_STATUSES),
        or(isNull(outbox.nextRetryAt), lte(outbox.nextRetryAt, now))
      )).returning();
      if (claimed) {
        return {
          id: String(claimed.id),
          publishTaskId: String(claimed.publishTaskId),
          attempts: Number(claimed.attempts),
          targetStatus: claimed.targetStatus as "已发布" | "未发布",
          payload: claimed.payloadJson as PatchPublishTaskStatusPayload
        };
      }
    }
    return null;
  },

  async markReported(entry, actor, now) {
    const outbox = outboxTable();
    await db.update(outbox).set({
      status: "REPORTED",
      lastError: null,
      reportedAt: now,
      updatedAt: now
    }).where(and(
      eq(outbox.tenantId, config.tenantId),
      eq(outbox.id, entry.id)
    ));
    await db.update(schema.publishTasks).set(publishTaskValues({
      reportStatus: "REPORTED",
      reportAttempts: entry.attempts,
      reportLastError: null,
      reportedAt: now,
      updatedAt: now,
      updatedBy: actor
    })).where(and(
      eq(schema.publishTasks.tenantId, config.tenantId),
      eq(schema.publishTasks.id, entry.publishTaskId),
      isNull(schema.publishTasks.deletedAt)
    ));
  },

  async markRetry(entry, error, actor, now) {
    const outbox = outboxTable();
    await db.update(outbox).set({
      status: "RETRY_WAIT",
      lastError: error,
      nextRetryAt: nextPublishStatusRetryAt(entry.attempts, now),
      updatedAt: now
    }).where(and(
      eq(outbox.tenantId, config.tenantId),
      eq(outbox.id, entry.id)
    ));
    await db.update(schema.publishTasks).set(publishTaskValues({
      reportStatus: "REPORT_FAILED",
      reportAttempts: entry.attempts,
      reportLastError: error,
      updatedAt: now,
      updatedBy: actor
    })).where(and(
      eq(schema.publishTasks.tenantId, config.tenantId),
      eq(schema.publishTasks.id, entry.publishTaskId),
      isNull(schema.publishTasks.deletedAt)
    ));
  },

  async markManualReview(entry, error, actor, now) {
    const outbox = outboxTable();
    await db.update(outbox).set({
      status: "MANUAL_REVIEW",
      lastError: error,
      terminalAt: now,
      updatedAt: now
    }).where(and(eq(outbox.tenantId, config.tenantId), eq(outbox.id, entry.id)));
    const [task] = await db.update(schema.publishTasks).set(publishTaskValues({
      reportStatus: "MANUAL_REVIEW",
      reportLastError: error,
      errorCategory: "EXTERNAL_SYNC_FAILED",
      updatedAt: now,
      updatedBy: actor
    })).where(and(
      eq(schema.publishTasks.tenantId, config.tenantId),
      eq(schema.publishTasks.id, entry.publishTaskId),
      isNull(schema.publishTasks.deletedAt)
    )).returning();
    if (task?.interfaceRunId) {
      await db.insert(schema.publishInterfaceAlerts).values({
        tenantId: config.tenantId,
        runId: task.interfaceRunId,
        slotExecutionId: task.slotExecutionId,
        code: "EXTERNAL_SYNC_FAILED",
        severity: "ERROR",
        message: "外部状态同步发生业务冲突，请人工核对",
        detailsJson: { publishTaskId: task.id, error },
        createdBy: actor,
        updatedBy: actor
      });
    }
  }
};

export async function createPublishStatusOutbox(
  publishTaskId: string,
  actor: string,
  now = new Date(),
  options: {
    repository?: PublishStatusOutboxRepository;
    loadContext?: (publishTaskId: string) => Promise<PublishTaskContext | null>;
  } = {}
) {
  const context = await (options.loadContext ?? findPublishTaskContext)(publishTaskId);
  if (!context) throw new Error("PUBLISH_TASK_NOT_FOUND");
  return (options.repository ?? databaseRepository).enqueue(snapshotFromContext(context), actor, now);
}

export async function markPublishTaskReportNotRequired(publishTaskId: string, actor: string) {
  const now = new Date();
  return db.update(schema.publishTasks).set(publishTaskValues({
    status: "REPORTED",
    reportStatus: "NOT_REQUIRED",
    reportAttempts: 0,
    reportLastError: null,
    reportedAt: now,
    updatedAt: now,
    updatedBy: actor
  })).where(and(
    eq(schema.publishTasks.tenantId, config.tenantId),
    eq(schema.publishTasks.id, publishTaskId),
    isNull(schema.publishTasks.deletedAt)
  ));
}

export async function markPublishTaskReportFailed(publishTaskId: string, error: unknown, actor: string) {
  const now = new Date();
  return db.update(schema.publishTasks).set(publishTaskValues({
    reportStatus: "REPORT_FAILED",
    reportLastError: errorMessage(error),
    updatedAt: now,
    updatedBy: actor
  })).where(and(
    eq(schema.publishTasks.tenantId, config.tenantId),
    eq(schema.publishTasks.id, publishTaskId),
    isNull(schema.publishTasks.deletedAt)
  ));
}

export async function processNextPublishStatusOutbox(
  actor: string,
  options: {
    now?: Date;
    repository?: PublishStatusOutboxRepository;
    buildPatch?: (entry: PublishStatusOutboxEntry) => Promise<PublishStatusOutboxPatch>;
    patchStatus?: (patch: PublishStatusOutboxPatch) => Promise<unknown>;
  } = {}
) {
  const now = options.now ?? new Date();
  const repository = options.repository ?? databaseRepository;
  const entry = await repository.claimReady(now, actor);
  if (!entry) return { outcome: "EMPTY" as const };

  try {
    const patch = await (options.buildPatch ?? (async (outboxEntry) => {
      const context = await findPublishTaskContext(outboxEntry.publishTaskId);
      if (!context) throw new Error("PUBLISH_TASK_NOT_FOUND");
      return buildPatch(context, outboxEntry);
    }))(entry);
    await (options.patchStatus ?? ((input) => patchTaskStatus(
      input.clientConfig,
      input.externalTaskId,
      input.payload
    )))(patch);
    await repository.markReported(entry, actor, now);
    return { outcome: "REPORTED" as const, entry };
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const status = Number((error as { status?: unknown }).status);
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        const code = "code" in error ? String((error as { code?: unknown }).code) : errorMessage(error);
        await repository.markManualReview(entry, code, actor, now);
        return { outcome: "MANUAL_REVIEW" as const, entry, error: code };
      }
    }
    const message = errorMessage(error);
    await repository.markRetry(entry, message, actor, now);
    return { outcome: "RETRY_PENDING" as const, entry, error: message };
  }
}
let outboxWorkerTimer: ReturnType<typeof setInterval> | null = null;

export async function runPublishStatusOutboxTick(actor = "publish-status-outbox") {
  const outcomes = [];
  for (let index = 0; index < 10; index += 1) {
    const result = await processNextPublishStatusOutbox(actor);
    if (result.outcome === "EMPTY") break;
    outcomes.push(result);
  }
  return outcomes;
}

export function startPublishStatusOutboxWorker() {
  if (outboxWorkerTimer) return outboxWorkerTimer;
  outboxWorkerTimer = setInterval(() => {
    void runPublishStatusOutboxTick();
  }, 30_000);
  outboxWorkerTimer.unref?.();
  return outboxWorkerTimer;
}

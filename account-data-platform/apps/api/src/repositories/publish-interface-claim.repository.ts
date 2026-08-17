import {
  publishInterfaceAlerts,
  publishSlotExecutions,
  publishTasks
} from "@pkg/db/schema";
import type { ClaimedWecomPublishTask } from "@pkg/types";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export type SaveInterfaceClaimedTaskInput = {
  runId: string;
  configId: string;
  slotExecutionId: string;
  accountName: string;
  task: ClaimedWecomPublishTask;
  actor: string;
  claimedAt: Date;
};

export type RecordInterfaceClaimRejectedInput = {
  slotExecutionId: string;
  code: string;
  retryable: boolean;
  nextRetryAt: Date | null;
  actor: string;
  occurredAt: Date;
};

export type ResolveInterfaceClaimUnknownInput = {
  slotExecutionId: string;
  resolution: "SAFE_TO_RETRY";
  evidence: string;
  actor: string;
  resolvedAt: Date;
};

export async function findInterfaceClaimUnknownAlertId(
  slotExecutionId: string
): Promise<string | null> {
  const [alert] = await db.select({ id: publishInterfaceAlerts.id })
    .from(publishInterfaceAlerts)
    .where(and(
      eq(publishInterfaceAlerts.tenantId, config.tenantId),
      eq(publishInterfaceAlerts.slotExecutionId, slotExecutionId),
      eq(publishInterfaceAlerts.code, "CLAIM_RESULT_UNKNOWN"),
      isNull(publishInterfaceAlerts.resolvedAt),
      isNull(publishInterfaceAlerts.deletedAt)
    ))
    .orderBy(desc(publishInterfaceAlerts.createdAt))
    .limit(1);
  return alert?.id ?? null;
}

export async function markInterfaceClaimNoMaterial(
  slotExecutionId: string,
  nextRetryAt: Date,
  actor: string
) {
  await db.update(publishSlotExecutions).set({
    status: "NO_MATERIAL",
    nextRetryAt,
    attemptCount: sql`${publishSlotExecutions.attemptCount} + 1`,
    errorCategory: null,
    lastError: null,
    updatedAt: new Date(),
    updatedBy: actor
  }).where(and(
    eq(publishSlotExecutions.tenantId, config.tenantId),
    eq(publishSlotExecutions.id, slotExecutionId),
    isNull(publishSlotExecutions.deletedAt)
  ));
}

export async function markInterfaceClaimResultUnknown(input: {
  runId: string;
  slotExecutionId: string;
  code: string;
  actor: string;
  occurredAt: Date;
}) {
  return db.transaction(async (transaction) => {
    await transaction.update(publishSlotExecutions).set({
      status: "CLAIM_RESULT_UNKNOWN",
      nextRetryAt: null,
      attemptCount: sql`${publishSlotExecutions.attemptCount} + 1`,
      errorCategory: "INTERFACE_FLOW_FAILED",
      lastError: input.code,
      updatedAt: input.occurredAt,
      updatedBy: input.actor
    }).where(and(
      eq(publishSlotExecutions.tenantId, config.tenantId),
      eq(publishSlotExecutions.id, input.slotExecutionId),
      isNull(publishSlotExecutions.deletedAt)
    ));
    const [alert] = await transaction.insert(publishInterfaceAlerts).values({
      tenantId: config.tenantId,
      runId: input.runId,
      slotExecutionId: input.slotExecutionId,
      code: "CLAIM_RESULT_UNKNOWN",
      severity: "ERROR",
      message: "外部任务领取结果未知，请人工核对后处理",
      detailsJson: { reason: input.code },
      createdBy: input.actor,
      updatedBy: input.actor
    }).returning({ id: publishInterfaceAlerts.id });
    if (!alert) throw new Error("INTERFACE_CLAIM_UNKNOWN_ALERT_CREATE_FAILED");
    return { alertId: alert.id };
  });
}

export async function saveInterfaceClaimedTask(input: SaveInterfaceClaimedTaskInput) {
  return db.transaction(async (transaction) => {
    const [created] = await transaction.insert(publishTasks).values({
      tenantId: config.tenantId,
      configId: input.configId,
      taskId: input.task.taskId,
      platform: "DOUYIN",
      accountName: input.accountName,
      title: input.task.title,
      description: input.task.description,
      coverUrl: input.task.coverUrl?.trim() || null,
      videoUrl: input.task.videoUrl?.trim() || "",
      status: "CLAIMED",
      source: "INTERFACE_PUBLISH",
      reportMode: "EXTERNAL",
      rawPayload: input.task,
      claimedAt: input.claimedAt,
      interfaceRunId: input.runId,
      slotExecutionId: input.slotExecutionId,
      createdBy: input.actor,
      updatedBy: input.actor
    }).onConflictDoNothing({
      target: [publishTasks.tenantId, publishTasks.platform, publishTasks.taskId]
    }).returning({ id: publishTasks.id, taskId: publishTasks.taskId });

    let task = created;
    if (!task) {
      [task] = await transaction.select({ id: publishTasks.id, taskId: publishTasks.taskId })
        .from(publishTasks)
        .where(and(
          eq(publishTasks.tenantId, config.tenantId),
          eq(publishTasks.platform, "DOUYIN"),
          eq(publishTasks.taskId, input.task.taskId),
          isNull(publishTasks.deletedAt)
        ))
        .limit(1);
    }
    if (!task) throw new Error("INTERFACE_CLAIM_IDEMPOTENCY_LOOKUP_FAILED");

    await transaction.update(publishSlotExecutions).set({
      status: "CLAIMED",
      externalTaskId: task.taskId,
      publishTaskId: task.id,
      nextRetryAt: null,
      attemptCount: sql`${publishSlotExecutions.attemptCount} + 1`,
      errorCategory: null,
      lastError: null,
      updatedAt: input.claimedAt,
      updatedBy: input.actor
    }).where(and(
      eq(publishSlotExecutions.tenantId, config.tenantId),
      eq(publishSlotExecutions.id, input.slotExecutionId),
      isNull(publishSlotExecutions.deletedAt)
    ));
    return { publishTaskId: task.id, externalTaskId: task.taskId };
  });
}

export async function recordInterfaceClaimRejected(input: RecordInterfaceClaimRejectedInput) {
  await db.update(publishSlotExecutions).set({
    status: input.retryable ? "ELIGIBLE" : "FAILED",
    nextRetryAt: input.nextRetryAt,
    attemptCount: sql`${publishSlotExecutions.attemptCount} + 1`,
    errorCategory: "INTERFACE_FLOW_FAILED",
    lastError: input.code,
    updatedAt: input.occurredAt,
    updatedBy: input.actor
  }).where(and(
    eq(publishSlotExecutions.tenantId, config.tenantId),
    eq(publishSlotExecutions.id, input.slotExecutionId),
    isNull(publishSlotExecutions.deletedAt)
  ));
}

export async function resolveInterfaceClaimResultUnknown(
  input: ResolveInterfaceClaimUnknownInput
) {
  return db.transaction(async (transaction) => {
    const [alert] = await transaction.update(publishInterfaceAlerts).set({
      detailsJson: {
        resolution: input.resolution,
        evidence: input.evidence,
        actor: input.actor
      },
      resolvedAt: input.resolvedAt,
      updatedAt: input.resolvedAt,
      updatedBy: input.actor
    }).where(and(
      eq(publishInterfaceAlerts.tenantId, config.tenantId),
      eq(publishInterfaceAlerts.slotExecutionId, input.slotExecutionId),
      eq(publishInterfaceAlerts.code, "CLAIM_RESULT_UNKNOWN"),
      isNull(publishInterfaceAlerts.resolvedAt),
      isNull(publishInterfaceAlerts.deletedAt)
    )).returning({ id: publishInterfaceAlerts.id });
    if (!alert) return false;
    const [slot] = await transaction.update(publishSlotExecutions).set({
      status: "ELIGIBLE",
      nextRetryAt: null,
      errorCategory: null,
      lastError: null,
      updatedAt: input.resolvedAt,
      updatedBy: input.actor
    }).where(and(
      eq(publishSlotExecutions.tenantId, config.tenantId),
      eq(publishSlotExecutions.id, input.slotExecutionId),
      eq(publishSlotExecutions.status, "CLAIM_RESULT_UNKNOWN"),
      isNull(publishSlotExecutions.deletedAt)
    )).returning({ id: publishSlotExecutions.id });
    return Boolean(slot);
  });
}

export const publishInterfaceClaimRepository = {
  findClaimResultUnknownAlertId: findInterfaceClaimUnknownAlertId,
  markNoMaterial: markInterfaceClaimNoMaterial,
  markClaimResultUnknown: markInterfaceClaimResultUnknown,
  saveClaimedTask: saveInterfaceClaimedTask,
  recordRejected: recordInterfaceClaimRejected,
  resolveClaimResultUnknown: resolveInterfaceClaimResultUnknown
};

export type PublishInterfaceClaimRepository = typeof publishInterfaceClaimRepository;

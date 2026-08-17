import { collectorDevices, mobileCommands, publishInterfaceAlerts, publishSlotExecutions, publishStatusOutbox, publishTasks } from "@pkg/db/schema";
import type { InterfacePublishLocalResult, InterfacePublishPhoneResultPayload, InterfacePublishSlot } from "@pkg/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../repositories/db";
import { businessDateInShanghai } from "./publish-interface-start-time";
import { isInterfacePublishWindowExpired } from "./publish-interface-time.service";

const PHONE_RESULT_TIMEOUT_MS = 15 * 60 * 1000;
const RETRY_DELAYS_MS = [60_000, 3 * 60_000, 10 * 60_000] as const;
export type PublishInterfaceResultContext = {
  publishTaskId: string;
  runId: string;
  slotExecutionId: string;
  bindingId: string;
  deviceCode: string | null;
  businessDate: string;
  slot: InterfacePublishSlot;
  localResultStatus: InterfacePublishLocalResult | null;
  taskStatus: string;
  dispatchRetryCount: number;
  dispatchedAt: Date | null;
  commandFetchedAt: Date | null;
};

type ResultRecord = { localResultStatus: InterfacePublishLocalResult; idempotent?: boolean; retryPending?: boolean; alertId?: string };

export type PublishInterfaceResultRepository = {
  findContext: (publishTaskId: string) => Promise<PublishInterfaceResultContext | null>;
  savePublished: (input: { context: PublishInterfaceResultContext; publishedUrl: string | null; platformContentId: string | null; actor: string; occurredAt: Date }) => Promise<ResultRecord>;
  scheduleRetry: (input: { context: PublishInterfaceResultContext; retryCount: number; nextRetryAt: Date; error: string; actor: string; occurredAt: Date }) => Promise<ResultRecord>;
  saveFinalFailure: (input: { context: PublishInterfaceResultContext; error: string; actor: string; occurredAt: Date }) => Promise<ResultRecord>;
  saveResultUnknown: (input: { context: PublishInterfaceResultContext; reason: string; actor: string; occurredAt: Date }) => Promise<ResultRecord>;
  resolveResultUnknown: (input: { context: PublishInterfaceResultContext; resolution: "PUBLISHED" | "FAILED"; evidence: string; actor: string; occurredAt: Date }) => Promise<ResultRecord>;
};

type ResultServiceDependencies = { repository?: PublishInterfaceResultRepository; now?: () => Date };

type Database = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function resolvePublishedSlotCredit(context: Pick<PublishInterfaceResultContext, "businessDate" | "slot">, publishedAt: Date) {
  const businessDate = businessDateInShanghai(publishedAt);
  const crossedBusinessDate = businessDate !== context.businessDate;
  return {
    crossedBusinessDate,
    businessDate,
    slot: crossedBusinessDate ? "MORNING" as const : context.slot
  };
}

async function creditPublishedSlot(database: Database, context: PublishInterfaceResultContext, publishedAt: Date, actor: string) {
  const credit = resolvePublishedSlotCredit(context, publishedAt);
  if (!credit.crossedBusinessDate) {
    await database.update(publishSlotExecutions).set({
      status: "PUBLISHED", publishedAt, nextRetryAt: null,
      errorCategory: null, lastError: null, updatedAt: publishedAt, updatedBy: actor
    }).where(eq(publishSlotExecutions.id, context.slotExecutionId));
    return;
  }
  await database.update(publishSlotExecutions).set({
    status: "WINDOW_EXPIRED", updatedAt: publishedAt, updatedBy: actor
  }).where(eq(publishSlotExecutions.id, context.slotExecutionId));
  await database.insert(publishSlotExecutions).values({
    tenantId: config.tenantId, runId: context.runId, bindingId: context.bindingId,
    businessDate: credit.businessDate, platform: "DOUYIN", slot: credit.slot,
    status: "PUBLISHED", publishedAt, createdBy: actor, updatedBy: actor
  }).onConflictDoUpdate({
    target: [
      publishSlotExecutions.tenantId, publishSlotExecutions.businessDate,
      publishSlotExecutions.platform, publishSlotExecutions.bindingId,
      publishSlotExecutions.slot
    ],
    set: { status: "PUBLISHED", publishedAt, updatedAt: publishedAt, updatedBy: actor }
  });
}

async function enqueueStatus(
  database: Database,
  publishTaskId: string,
  targetStatus: "已发布" | "未发布",
  payload: Record<string, unknown>,
  occurredAt: Date
) {
  await database.insert(publishStatusOutbox).values({
    tenantId: config.tenantId,
    publishTaskId,
    status: "REPORT_PENDING",
    targetStatus,
    payloadJson: payload,
    nextRetryAt: occurredAt,
    updatedAt: occurredAt
  }).onConflictDoNothing({
    target: [publishStatusOutbox.tenantId, publishStatusOutbox.publishTaskId]
  });
}

const databaseRepository: PublishInterfaceResultRepository = {
  async findContext(publishTaskId) {
    const [row] = await db.select({
      publishTaskId: publishTasks.id,
      runId: publishTasks.interfaceRunId,
      slotExecutionId: publishTasks.slotExecutionId,
      bindingId: publishSlotExecutions.bindingId,
      deviceCode: collectorDevices.deviceCode,
      businessDate: publishSlotExecutions.businessDate,
      slot: publishSlotExecutions.slot,
      localResultStatus: publishTasks.localResultStatus,
      taskStatus: publishTasks.status,
      dispatchRetryCount: publishTasks.dispatchRetryCount,
      dispatchedAt: publishTasks.dispatchedAt,
      commandFetchedAt: sql<Date | null>`(
        select max(${mobileCommands.fetchedAt}) from ${mobileCommands}
        where ${mobileCommands.tenantId} = ${config.tenantId}
          and ${mobileCommands.idempotencyKey} = ${publishTasks.id}::text || ':' || ${publishTasks.matchedDeviceId}::text
          and ${mobileCommands.deletedAt} is null
      )`
    }).from(publishTasks)
      .leftJoin(collectorDevices, eq(collectorDevices.id, publishTasks.matchedDeviceId))
      .innerJoin(publishSlotExecutions, eq(publishSlotExecutions.id, publishTasks.slotExecutionId))
      .where(and(
        eq(publishTasks.tenantId, config.tenantId),
        eq(publishTasks.id, publishTaskId),
        isNull(publishTasks.deletedAt),
        isNull(publishSlotExecutions.deletedAt)
      ))
      .limit(1);
    if (!row?.runId || !row.slotExecutionId) return null;
    return {
      ...row,
      runId: row.runId,
      slotExecutionId: row.slotExecutionId,
      slot: row.slot as InterfacePublishSlot,
      localResultStatus: row.localResultStatus as InterfacePublishLocalResult | null
    };
  },

  async savePublished(input) {
    return db.transaction(async (transaction) => {
      await transaction.update(publishTasks).set({
        status: "SUCCEEDED",
        localResultStatus: "PUBLISHED",
        resultError: null,
        errorCategory: null,
        publishedUrl: input.publishedUrl,
        platformContentId: input.platformContentId,
        finishedAt: input.occurredAt,
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(and(
        eq(publishTasks.tenantId, config.tenantId),
        eq(publishTasks.id, input.context.publishTaskId),
        isNull(publishTasks.deletedAt)
      ));
      await creditPublishedSlot(transaction, input.context, input.occurredAt, input.actor);
      await enqueueStatus(transaction, input.context.publishTaskId, "已发布", {
        platform: "抖音",
        status: "已发布",
        ...(input.publishedUrl ? { publishedUrl: input.publishedUrl } : {}),
        ...(input.platformContentId ? { platformContentId: input.platformContentId } : {})
      }, input.occurredAt);
      return { localResultStatus: "PUBLISHED", idempotent: false };
    });
  },

  async scheduleRetry(input) {
    await db.transaction(async (transaction) => {
      await transaction.update(publishTasks).set({
        status: "PUBLISH_BUSY",
        localResultStatus: "FAILED",
        errorCategory: "PUBLISH_EXECUTION_FAILED",
        resultError: input.error,
        dispatchRetryCount: input.retryCount,
        nextDispatchAt: input.nextRetryAt,
        finishedAt: input.occurredAt,
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(eq(publishTasks.id, input.context.publishTaskId));
      await transaction.update(publishSlotExecutions).set({
        status: "DEVICE_UNAVAILABLE",
        nextRetryAt: input.nextRetryAt,
        errorCategory: "PUBLISH_EXECUTION_FAILED",
        lastError: input.error,
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(eq(publishSlotExecutions.id, input.context.slotExecutionId));
    });
    return { localResultStatus: "FAILED", retryPending: true };
  },

  async saveFinalFailure(input) {
    await db.transaction(async (transaction) => {
      await transaction.update(publishTasks).set({
        status: "FAILED",
        localResultStatus: "FAILED",
        errorCategory: "PUBLISH_EXECUTION_FAILED",
        resultError: input.error,
        nextDispatchAt: null,
        finishedAt: input.occurredAt,
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(eq(publishTasks.id, input.context.publishTaskId));
      await transaction.update(publishSlotExecutions).set({
        status: "FAILED",
        nextRetryAt: null,
        errorCategory: "PUBLISH_EXECUTION_FAILED",
        lastError: input.error,
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(eq(publishSlotExecutions.id, input.context.slotExecutionId));
      await enqueueStatus(transaction, input.context.publishTaskId, "未发布", {
        platform: "抖音",
        status: "未发布",
        error: input.error
      }, input.occurredAt);
    });
    return { localResultStatus: "FAILED", retryPending: false };
  },

  async saveResultUnknown(input) {
    return db.transaction(async (transaction) => {
      await transaction.update(publishTasks).set({
        status: "RESULT_UNKNOWN",
        localResultStatus: "RESULT_UNKNOWN",
        errorCategory: "PUBLISH_EXECUTION_FAILED",
        resultError: input.reason,
        nextDispatchAt: null,
        finishedAt: input.occurredAt,
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(eq(publishTasks.id, input.context.publishTaskId));
      await transaction.update(publishSlotExecutions).set({
        status: "RESULT_UNKNOWN",
        nextRetryAt: null,
        errorCategory: "PUBLISH_EXECUTION_FAILED",
        lastError: input.reason,
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(eq(publishSlotExecutions.id, input.context.slotExecutionId));
      const [alert] = await transaction.insert(publishInterfaceAlerts).values({
        tenantId: config.tenantId,
        runId: input.context.runId,
        slotExecutionId: input.context.slotExecutionId,
        code: "RESULT_UNKNOWN",
        severity: "ERROR",
        message: "手机发布结果未知，请人工核对账号后确认",
        detailsJson: { publishTaskId: input.context.publishTaskId, reason: input.reason },
        createdBy: input.actor,
        updatedBy: input.actor
      }).returning({ id: publishInterfaceAlerts.id });
      if (!alert) throw new Error("INTERFACE_RESULT_UNKNOWN_ALERT_CREATE_FAILED");
      return { localResultStatus: "RESULT_UNKNOWN", alertId: alert.id };
    });
  },

  async resolveResultUnknown(input) {
    return db.transaction(async (transaction) => {
      const published = input.resolution === "PUBLISHED";
      await transaction.update(publishTasks).set({
        status: published ? "SUCCEEDED" : "FAILED",
        localResultStatus: input.resolution,
        errorCategory: published ? null : "PUBLISH_EXECUTION_FAILED",
        resultError: published ? null : input.evidence,
        finishedAt: input.occurredAt,
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(eq(publishTasks.id, input.context.publishTaskId));
      await transaction.update(publishSlotExecutions).set({
        status: input.resolution,
        publishedAt: published ? input.occurredAt : null,
        lastError: published ? null : input.evidence,
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(eq(publishSlotExecutions.id, input.context.slotExecutionId));
      await transaction.update(publishInterfaceAlerts).set({
        detailsJson: { resolution: input.resolution, evidence: input.evidence, actor: input.actor },
        resolvedAt: input.occurredAt,
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(and(
        eq(publishInterfaceAlerts.slotExecutionId, input.context.slotExecutionId),
        eq(publishInterfaceAlerts.code, "RESULT_UNKNOWN"),
        isNull(publishInterfaceAlerts.resolvedAt)
      ));
      await enqueueStatus(transaction, input.context.publishTaskId, published ? "已发布" : "未发布", {
        platform: "抖音",
        status: published ? "已发布" : "未发布",
        evidence: input.evidence
      }, input.occurredAt);
      return { localResultStatus: input.resolution };
    });
  }
};

function retryableTechnicalFailure(status: string, error: string) {
  if (status !== "FAILED") return false;
  return /(NETWORK|TIMEOUT|TEMPORARY|DOWNLOAD|DEVICE_OFFLINE|PUBLISH_BUSY)/i.test(error);
}

export function createPublishInterfaceResultService(dependencies: ResultServiceDependencies = {}) {
  const repository = dependencies.repository ?? databaseRepository;
  const now = dependencies.now ?? (() => new Date());

  async function requireContext(publishTaskId: string) {
    const value = await repository.findContext(publishTaskId);
    if (!value) throw new Error("PUBLISH_TASK_NOT_FOUND");
    return value;
  }

  return {
    async report(
      publishTaskId: string,
      input: Omit<InterfacePublishPhoneResultPayload, "deviceToken">,
      actor: string
    ) {
      const context = await requireContext(publishTaskId);
      if (context.deviceCode !== input.deviceId) throw new Error("PUBLISH_TASK_DEVICE_MISMATCH");
      if (context.localResultStatus === "PUBLISHED") {
        return { localResultStatus: "PUBLISHED" as const, idempotent: true };
      }
      if (context.localResultStatus === "RESULT_UNKNOWN") {
        return { localResultStatus: "RESULT_UNKNOWN" as const, idempotent: true };
      }
      const occurredAt = now();
      if (input.status === "SUCCEEDED" || input.status === "PUBLISHED") {
        return repository.savePublished({
          context,
          publishedUrl: input.publishedUrl ?? null,
          platformContentId: input.platformContentId ?? null,
          actor,
          occurredAt
        });
      }
      if (input.status === "RESULT_UNKNOWN") {
        return repository.saveResultUnknown({
          context,
          reason: input.error ?? "PHONE_RESULT_UNKNOWN",
          actor,
          occurredAt
        });
      }

      const error = input.error ?? input.status;
      const retryCount = context.dispatchRetryCount + 1;
      const retryable = retryableTechnicalFailure(input.status, error)
        && context.dispatchRetryCount < RETRY_DELAYS_MS.length
        && !isInterfacePublishWindowExpired(context.slot, context.businessDate, occurredAt);
      if (retryable) {
        const nextRetryAt = new Date(occurredAt.getTime() + RETRY_DELAYS_MS[retryCount - 1]);
        const result = await repository.scheduleRetry({
          context,
          retryCount,
          nextRetryAt,
          error,
          actor,
          occurredAt
        });
        return { ...result, retryCount, nextRetryAt };
      }
      return repository.saveFinalFailure({ context, error, actor, occurredAt });
    },

    async markTimedOut(publishTaskId: string, actor: string) {
      const context = await requireContext(publishTaskId);
      const occurredAt = now();
      if (context.localResultStatus || !context.commandFetchedAt
        || occurredAt.getTime() - context.commandFetchedAt.getTime() < PHONE_RESULT_TIMEOUT_MS) {
        return { timedOut: false };
      }
      return repository.saveResultUnknown({
        context,
        reason: "PHONE_RESULT_TIMEOUT",
        actor,
        occurredAt
      });
    },

    async resolveResultUnknown(input: {
      publishTaskId: string;
      resolution: "PUBLISHED" | "FAILED";
      evidence: string;
      actor: string;
    }) {
      const evidence = input.evidence.trim();
      if (!evidence) throw new Error("RESULT_UNKNOWN_EVIDENCE_REQUIRED");
      const context = await requireContext(input.publishTaskId);
      if (context.localResultStatus !== "RESULT_UNKNOWN") {
        throw new Error("PUBLISH_TASK_RESULT_STATE_INVALID");
      }
      return repository.resolveResultUnknown({
        context,
        resolution: input.resolution,
        evidence,
        actor: input.actor,
        occurredAt: now()
      });
    }
  };
}

export const publishInterfaceResultService = createPublishInterfaceResultService();

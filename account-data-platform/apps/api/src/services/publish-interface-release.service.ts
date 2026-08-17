import { publishSlotExecutions, publishStatusOutbox, publishTasks } from "@pkg/db/schema";
import type { InterfacePublishLocalResult, PatchPublishTaskStatusPayload } from "@pkg/types";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "../repositories/db";

export type PublishInterfaceReleaseTask = {
  publishTaskId: string;
  runId: string;
  bindingId: string;
  localResultStatus: InterfacePublishLocalResult | null;
  sideEffectStartedAt: Date | null;
};

export type PublishInterfaceReleaseRepository = {
  findTask: (publishTaskId: string) => Promise<PublishInterfaceReleaseTask | null>;
  enqueueRelease: (input: {
    publishTaskId: string;
    targetStatus: "未发布";
    payload: PatchPublishTaskStatusPayload;
    reason: string;
    actor: string;
    occurredAt: Date;
  }) => Promise<{ outboxId: string }>;
  isAccountBlocked: (runId: string, bindingId: string) => Promise<boolean>;
};

type ReleaseDependencies = {
  repository?: PublishInterfaceReleaseRepository;
  now?: () => Date;
};

const databaseRepository: PublishInterfaceReleaseRepository = {
  async findTask(publishTaskId) {
    const [row] = await db.select({
      publishTaskId: publishTasks.id,
      runId: publishTasks.interfaceRunId,
      bindingId: publishSlotExecutions.bindingId,
      localResultStatus: publishTasks.localResultStatus,
      sideEffectStartedAt: publishTasks.sideEffectStartedAt
    }).from(publishTasks)
      .innerJoin(publishSlotExecutions, eq(publishSlotExecutions.id, publishTasks.slotExecutionId))
      .where(and(
        eq(publishTasks.tenantId, config.tenantId),
        eq(publishTasks.id, publishTaskId),
        isNull(publishTasks.deletedAt),
        isNull(publishSlotExecutions.deletedAt)
      ))
      .limit(1);
    if (!row?.runId) return null;
    return {
      ...row,
      runId: row.runId,
      localResultStatus: row.localResultStatus as InterfacePublishLocalResult | null
    };
  },

  async enqueueRelease(input) {
    return db.transaction(async (transaction) => {
      await transaction.update(publishTasks).set({
        status: "RELEASE_PENDING",
        reportStatus: "REPORT_PENDING",
        resultError: input.reason,
        errorCategory: "INTERFACE_FLOW_FAILED",
        updatedAt: input.occurredAt,
        updatedBy: input.actor
      }).where(and(
        eq(publishTasks.tenantId, config.tenantId),
        eq(publishTasks.id, input.publishTaskId),
        isNull(publishTasks.sideEffectStartedAt),
        isNull(publishTasks.localResultStatus),
        isNull(publishTasks.deletedAt)
      ));
      const [outbox] = await transaction.insert(publishStatusOutbox).values({
        tenantId: config.tenantId,
        publishTaskId: input.publishTaskId,
        status: "PENDING",
        targetStatus: input.targetStatus,
        payloadJson: input.payload,
        nextRetryAt: input.occurredAt
      }).onConflictDoNothing({
        target: [publishStatusOutbox.tenantId, publishStatusOutbox.publishTaskId]
      }).returning({ id: publishStatusOutbox.id });
      if (outbox) return { outboxId: outbox.id };
      const [existing] = await transaction.select({ id: publishStatusOutbox.id })
        .from(publishStatusOutbox)
        .where(and(
          eq(publishStatusOutbox.tenantId, config.tenantId),
          eq(publishStatusOutbox.publishTaskId, input.publishTaskId)
        ))
        .limit(1);
      if (!existing) throw new Error("INTERFACE_RELEASE_OUTBOX_CREATE_FAILED");
      return { outboxId: existing.id };
    });
  },

  async isAccountBlocked(runId, bindingId) {
    const [row] = await db.select({ id: publishStatusOutbox.id })
      .from(publishStatusOutbox)
      .innerJoin(publishTasks, eq(publishTasks.id, publishStatusOutbox.publishTaskId))
      .innerJoin(publishSlotExecutions, eq(publishSlotExecutions.id, publishTasks.slotExecutionId))
      .where(and(
        eq(publishTasks.interfaceRunId, runId),
        eq(publishSlotExecutions.bindingId, bindingId),
        inArray(publishStatusOutbox.status, ["PENDING", "REPORT_PENDING", "REPORTING", "RETRY_WAIT", "MANUAL_REVIEW"]),
        eq(publishStatusOutbox.targetStatus, "未发布")
      ))
      .limit(1);
    return Boolean(row);
  }
};

export function createPublishInterfaceReleaseService(dependencies: ReleaseDependencies = {}) {
  const repository = dependencies.repository ?? databaseRepository;
  const now = dependencies.now ?? (() => new Date());
  return {
    async releaseBeforeSideEffect(input: {
      publishTaskId: string;
      reason: string;
      actor: string;
    }) {
      const task = await repository.findTask(input.publishTaskId);
      if (!task) throw new Error("PUBLISH_TASK_NOT_FOUND");
      if (task.localResultStatus === "RESULT_UNKNOWN") {
        throw new Error("INTERFACE_RELEASE_RESULT_UNKNOWN");
      }
      if (task.sideEffectStartedAt) throw new Error("INTERFACE_RELEASE_SIDE_EFFECT_STARTED");
      if (task.localResultStatus) throw new Error("INTERFACE_RELEASE_RESULT_ALREADY_FINAL");
      const reason = input.reason.trim();
      if (!reason) throw new Error("INTERFACE_RELEASE_REASON_REQUIRED");
      return repository.enqueueRelease({
        publishTaskId: task.publishTaskId,
        targetStatus: "未发布",
        payload: { platform: "抖音", status: "未发布", error: reason },
        reason,
        actor: input.actor,
        occurredAt: now()
      });
    },

    isAccountClaimBlocked(runId: string, bindingId: string) {
      return repository.isAccountBlocked(runId, bindingId);
    }
  };
}

export const publishInterfaceReleaseService = createPublishInterfaceReleaseService();

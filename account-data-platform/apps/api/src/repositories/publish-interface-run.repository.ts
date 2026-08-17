import { publishRunBindings, publishRuns, publishSlotExecutions } from "@pkg/db/schema";
import type {
  InterfacePublishBindingStatus,
  InterfacePublishReservationStatus,
  InterfacePublishRunConfig,
  InterfacePublishRunStatus
} from "@pkg/types";
import { and, countDistinct, desc, eq, inArray, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export type PublishInterfaceRunRow = InterfacePublishRunConfig & {
  id: string;
  status: InterfacePublishRunStatus;
};

export type CreateInterfacePublishRunInput = {
  config: InterfacePublishRunConfig;
  actor: string;
};

export type InterfacePublishRunBindingSnapshot = {
  bindingId: string;
  deviceId: string;
  deviceCode: string;
  accountName: string;
  accountNo: string;
  externalAccountKey: string;
  status: InterfacePublishBindingStatus;
  reservationStatus: InterfacePublishReservationStatus;
  skippedForRun: boolean;
};

export type ConfirmInterfacePublishRunInput = {
  runId: string;
  actor: string;
  bindings: InterfacePublishRunBindingSnapshot[];
};

export interface PublishInterfaceRunRepository {
  create(input: CreateInterfacePublishRunInput): Promise<PublishInterfaceRunRow>;
  findById(runId: string): Promise<PublishInterfaceRunRow | null>;
  findCurrent(): Promise<PublishInterfaceRunRow | null>;
  countBindingsWithoutPublishedSlot(runId: string, businessDate: string): Promise<number>;
  transition(
    runId: string,
    expected: InterfacePublishRunStatus[],
    status: InterfacePublishRunStatus,
    actor: string
  ): Promise<PublishInterfaceRunRow | null>;
  confirm(input: ConfirmInterfacePublishRunInput): Promise<{
    run: PublishInterfaceRunRow;
    bindings: InterfacePublishRunBindingSnapshot[];
  } | null>;
}

function mapRun(row: typeof publishRuns.$inferSelect): PublishInterfaceRunRow {
  return {
    id: row.id,
    status: row.status as InterfacePublishRunStatus,
    configId: row.configId,
    morningPublishTime: row.morningPublishTime,
    afternoonPublishTime: row.afternoonPublishTime,
    maxConcurrentPublishing: row.maxConcurrentPublishing,
    noMaterialRetryMinutes: row.noMaterialRetryMinutes,
    timezone: row.timezone as "Asia/Shanghai",
    platform: "DOUYIN"
  };
}

export async function createInterfacePublishRun(input: CreateInterfacePublishRunInput) {
  const [created] = await db.insert(publishRuns).values({
    tenantId: config.tenantId,
    configId: input.config.configId,
    status: "CHECKING_BINDINGS",
    timezone: input.config.timezone,
    morningPublishTime: input.config.morningPublishTime,
    afternoonPublishTime: input.config.afternoonPublishTime,
    maxConcurrentPublishing: input.config.maxConcurrentPublishing,
    noMaterialRetryMinutes: input.config.noMaterialRetryMinutes,
    startedBy: input.actor,
    createdBy: input.actor,
    updatedBy: input.actor
  }).returning();
  if (!created) throw new Error("INTERFACE_PUBLISH_RUN_CREATE_FAILED");
  return mapRun(created);
}

export async function findInterfacePublishRunById(runId: string) {
  const [run] = await db.select().from(publishRuns).where(and(
    eq(publishRuns.tenantId, config.tenantId),
    eq(publishRuns.id, runId),
    isNull(publishRuns.deletedAt)
  )).limit(1);
  return run ? mapRun(run) : null;
}

export async function findCurrentInterfacePublishRun() {
  const [run] = await db.select().from(publishRuns).where(and(
    eq(publishRuns.tenantId, config.tenantId),
    inArray(publishRuns.status, [
      "DRAFT",
      "CHECKING_BINDINGS",
      "WAITING_USER_CONFIRMATION",
      "SCHEDULED",
      "RUNNING",
      "STOPPING",
      "PAUSED"
    ]),
    isNull(publishRuns.deletedAt)
  )).orderBy(desc(publishRuns.createdAt)).limit(1);
  return run ? mapRun(run) : null;
}

export async function countInterfacePublishBindingsWithoutPublishedSlot(
  runId: string,
  businessDate: string
) {
  const [result] = await db.select({ count: countDistinct(publishRunBindings.bindingId) })
    .from(publishRunBindings)
    .leftJoin(publishSlotExecutions, and(
      eq(publishSlotExecutions.tenantId, config.tenantId),
      eq(publishSlotExecutions.bindingId, publishRunBindings.bindingId),
      eq(publishSlotExecutions.businessDate, businessDate),
      eq(publishSlotExecutions.status, "PUBLISHED"),
      isNull(publishSlotExecutions.deletedAt)
    ))
    .where(and(
      eq(publishRunBindings.tenantId, config.tenantId),
      eq(publishRunBindings.runId, runId),
      eq(publishRunBindings.skippedForRun, false),
      isNull(publishRunBindings.deletedAt),
      isNull(publishSlotExecutions.id)
    ));
  return Number(result?.count ?? 0);
}

export async function transitionInterfacePublishRun(
  runId: string,
  expected: InterfacePublishRunStatus[],
  status: InterfacePublishRunStatus,
  actor: string
) {
  const timestamp = new Date();
  const lifecycleFields = status === "STOPPING"
    ? { stopRequestedBy: actor, stopRequestedAt: timestamp }
    : status === "STOPPED"
      ? { stoppedAt: timestamp }
      : {};
  const [updated] = await db.update(publishRuns).set({
    status,
    ...lifecycleFields,
    updatedAt: timestamp,
    updatedBy: actor
  }).where(and(
    eq(publishRuns.tenantId, config.tenantId),
    eq(publishRuns.id, runId),
    inArray(publishRuns.status, expected),
    isNull(publishRuns.deletedAt)
  )).returning();
  return updated ? mapRun(updated) : null;
}

export async function confirmInterfacePublishRun(input: ConfirmInterfacePublishRunInput) {
  return db.transaction(async (transaction) => {
    const timestamp = new Date();
    const [updated] = await transaction.update(publishRuns).set({
      status: "SCHEDULED",
      confirmedBy: input.actor,
      confirmedAt: timestamp,
      updatedAt: timestamp,
      updatedBy: input.actor
    }).where(and(
      eq(publishRuns.tenantId, config.tenantId),
      eq(publishRuns.id, input.runId),
      eq(publishRuns.status, "WAITING_USER_CONFIRMATION"),
      isNull(publishRuns.deletedAt)
    )).returning();
    if (!updated) return null;

    if (input.bindings.length) {
      await transaction.insert(publishRunBindings).values(input.bindings.map((binding) => ({
        tenantId: config.tenantId,
        runId: input.runId,
        bindingId: binding.bindingId,
        deviceId: binding.deviceId,
        deviceCode: binding.deviceCode,
        platform: "DOUYIN",
        accountName: binding.accountName,
        accountNo: binding.accountNo,
        externalAccountKey: binding.externalAccountKey,
        status: binding.status,
        reservationStatus: binding.reservationStatus,
        skippedForRun: binding.skippedForRun,
        createdBy: input.actor,
        updatedBy: input.actor
      })));
    }
    return { run: mapRun(updated), bindings: input.bindings };
  });
}

export const publishInterfaceRunRepository: PublishInterfaceRunRepository = {
  create: createInterfacePublishRun,
  findById: findInterfacePublishRunById,
  findCurrent: findCurrentInterfacePublishRun,
  countBindingsWithoutPublishedSlot: countInterfacePublishBindingsWithoutPublishedSlot,
  transition: transitionInterfacePublishRun,
  confirm: confirmInterfacePublishRun
};

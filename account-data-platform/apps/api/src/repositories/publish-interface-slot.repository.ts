import { publishRuns, publishSlotExecutions } from "@pkg/db/schema";
import type { InterfacePublishSlot, InterfacePublishSlotStatus } from "@pkg/types";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export type InterfacePublishSlotRow = {
  id: string;
  runId: string;
  bindingId: string;
  businessDate: string;
  slot: InterfacePublishSlot;
  status: InterfacePublishSlotStatus;
  publishedAt: Date | null;
};

export type EnsureInterfacePublishSlotsInput = {
  runId: string;
  businessDate: string;
  bindings: Array<{ bindingId: string }>;
};

export interface PublishInterfaceSlotRepository {
  ensureDailySlots(input: EnsureInterfacePublishSlotsInput): Promise<InterfacePublishSlotRow[]>;
  markEligible(bindingIds: string[], businessDate: string, slot: InterfacePublishSlot): Promise<void>;
  expire(bindingIds: string[], businessDate: string, slot: InterfacePublishSlot): Promise<void>;
  markPublished(
    slotExecutionId: string,
    publishedAt: Date,
    actualBusinessDate: string
  ): Promise<{ original: InterfacePublishSlotRow; credited: InterfacePublishSlotRow }>;
}

function mapSlot(row: typeof publishSlotExecutions.$inferSelect): InterfacePublishSlotRow {
  return {
    id: row.id,
    runId: row.runId,
    bindingId: row.bindingId,
    businessDate: row.businessDate,
    slot: row.slot as InterfacePublishSlot,
    status: row.status as InterfacePublishSlotStatus,
    publishedAt: row.publishedAt
  };
}

export async function ensureInterfacePublishDailySlots(input: EnsureInterfacePublishSlotsInput) {
  if (!input.bindings.length) return [];
  const bindingIds = input.bindings.map((binding) => binding.bindingId);
  await db.insert(publishSlotExecutions).values(input.bindings.flatMap((binding) => ([
    {
      tenantId: config.tenantId,
      runId: input.runId,
      bindingId: binding.bindingId,
      businessDate: input.businessDate,
      platform: "DOUYIN",
      slot: "MORNING",
      status: "WAITING"
    },
    {
      tenantId: config.tenantId,
      runId: input.runId,
      bindingId: binding.bindingId,
      businessDate: input.businessDate,
      platform: "DOUYIN",
      slot: "AFTERNOON",
      status: "WAITING"
    }
  ]))).onConflictDoNothing({
    target: [
      publishSlotExecutions.tenantId,
      publishSlotExecutions.businessDate,
      publishSlotExecutions.platform,
      publishSlotExecutions.bindingId,
      publishSlotExecutions.slot
    ]
  });
  await db.update(publishSlotExecutions).set({
    runId: input.runId,
    updatedAt: new Date(),
    updatedBy: "interface_publish_restart"
  }).where(and(
    eq(publishSlotExecutions.tenantId, config.tenantId),
    eq(publishSlotExecutions.businessDate, input.businessDate),
    eq(publishSlotExecutions.platform, "DOUYIN"),
    inArray(publishSlotExecutions.bindingId, bindingIds),
    inArray(publishSlotExecutions.status, [
      "WAITING",
      "ELIGIBLE",
      "NO_MATERIAL",
      "DEVICE_UNAVAILABLE",
      "FAILED"
    ]),
    isNull(publishSlotExecutions.publishTaskId),
    inArray(
      publishSlotExecutions.runId,
      db.select({ id: publishRuns.id }).from(publishRuns).where(and(
        eq(publishRuns.tenantId, config.tenantId),
        inArray(publishRuns.status, ["STOPPED", "FAILED", "CANCELED"]),
        isNull(publishRuns.deletedAt)
      ))
    ),
    isNull(publishSlotExecutions.deletedAt)
  ));
  const rows = await db.select().from(publishSlotExecutions).where(and(
    eq(publishSlotExecutions.tenantId, config.tenantId),
    eq(publishSlotExecutions.businessDate, input.businessDate),
    eq(publishSlotExecutions.platform, "DOUYIN"),
    inArray(publishSlotExecutions.bindingId, bindingIds),
    isNull(publishSlotExecutions.deletedAt)
  ));
  return rows.map(mapSlot);
}

export async function markInterfacePublishSlotsEligible(
  bindingIds: string[],
  businessDate: string,
  slot: InterfacePublishSlot
) {
  if (!bindingIds.length) return;
  await db.update(publishSlotExecutions).set({
    status: "ELIGIBLE",
    updatedAt: new Date(),
    updatedBy: "interface_publish_scheduler"
  }).where(and(
    eq(publishSlotExecutions.tenantId, config.tenantId),
    eq(publishSlotExecutions.businessDate, businessDate),
    eq(publishSlotExecutions.platform, "DOUYIN"),
    eq(publishSlotExecutions.slot, slot),
    eq(publishSlotExecutions.status, "WAITING"),
    inArray(publishSlotExecutions.bindingId, bindingIds),
    isNull(publishSlotExecutions.deletedAt)
  ));
}

export async function expireInterfacePublishSlots(
  bindingIds: string[],
  businessDate: string,
  slot: InterfacePublishSlot
) {
  if (!bindingIds.length) return;
  await db.update(publishSlotExecutions).set({
    status: "WINDOW_EXPIRED",
    updatedAt: new Date(),
    updatedBy: "interface_publish_scheduler"
  }).where(and(
    eq(publishSlotExecutions.tenantId, config.tenantId),
    eq(publishSlotExecutions.businessDate, businessDate),
    eq(publishSlotExecutions.platform, "DOUYIN"),
    eq(publishSlotExecutions.slot, slot),
    inArray(publishSlotExecutions.bindingId, bindingIds),
    inArray(publishSlotExecutions.status, [
      "WAITING",
      "ELIGIBLE",
      "NO_MATERIAL",
      "DEVICE_UNAVAILABLE",
      "FAILED"
    ]),
    isNull(publishSlotExecutions.deletedAt)
  ));
}

export async function markInterfacePublishSlotPublished(
  slotExecutionId: string,
  publishedAt: Date,
  actualBusinessDate: string
) {
  return db.transaction(async (transaction) => {
    const [originalRow] = await transaction.select().from(publishSlotExecutions).where(and(
      eq(publishSlotExecutions.tenantId, config.tenantId),
      eq(publishSlotExecutions.id, slotExecutionId),
      isNull(publishSlotExecutions.deletedAt)
    )).limit(1).for("update");
    if (!originalRow) throw new Error("INTERFACE_PUBLISH_SLOT_NOT_FOUND");

    if (originalRow.businessDate === actualBusinessDate) {
      const [published] = await transaction.update(publishSlotExecutions).set({
        status: "PUBLISHED",
        publishedAt,
        updatedAt: publishedAt,
        updatedBy: "interface_publish_result"
      }).where(eq(publishSlotExecutions.id, originalRow.id)).returning();
      const mapped = mapSlot(published);
      return { original: mapped, credited: mapped };
    }

    const [expired] = await transaction.update(publishSlotExecutions).set({
      status: "WINDOW_EXPIRED",
      updatedAt: publishedAt,
      updatedBy: "interface_publish_result"
    }).where(eq(publishSlotExecutions.id, originalRow.id)).returning();

    await transaction.insert(publishSlotExecutions).values({
      tenantId: config.tenantId,
      runId: originalRow.runId,
      bindingId: originalRow.bindingId,
      businessDate: actualBusinessDate,
      platform: "DOUYIN",
      slot: "MORNING",
      status: "WAITING"
    }).onConflictDoNothing({
      target: [
        publishSlotExecutions.tenantId,
        publishSlotExecutions.businessDate,
        publishSlotExecutions.platform,
        publishSlotExecutions.bindingId,
        publishSlotExecutions.slot
      ]
    });

    const [credited] = await transaction.update(publishSlotExecutions).set({
      status: "PUBLISHED",
      publishedAt,
      updatedAt: publishedAt,
      updatedBy: "interface_publish_result"
    }).where(and(
      eq(publishSlotExecutions.tenantId, config.tenantId),
      eq(publishSlotExecutions.businessDate, actualBusinessDate),
      eq(publishSlotExecutions.platform, "DOUYIN"),
      eq(publishSlotExecutions.bindingId, originalRow.bindingId),
      eq(publishSlotExecutions.slot, "MORNING"),
      isNull(publishSlotExecutions.deletedAt)
    )).returning();
    return { original: mapSlot(expired), credited: mapSlot(credited) };
  });
}

export const publishInterfaceSlotRepository: PublishInterfaceSlotRepository = {
  ensureDailySlots: ensureInterfacePublishDailySlots,
  markEligible: markInterfacePublishSlotsEligible,
  expire: expireInterfacePublishSlots,
  markPublished: markInterfacePublishSlotPublished
};

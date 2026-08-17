import {
  publishInterfaceAlerts,
  publishRunBindings,
  publishRuns,
  publishSlotExecutions
} from "@pkg/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export async function getInterfacePublishRunDetails(runId: string) {
  const [run] = await db.select().from(publishRuns).where(and(
    eq(publishRuns.tenantId, config.tenantId),
    eq(publishRuns.id, runId),
    isNull(publishRuns.deletedAt)
  )).limit(1);
  if (!run) throw new Error("RUN_NOT_FOUND");
  const [bindings, slots, alerts] = await Promise.all([
    db.select().from(publishRunBindings).where(and(
      eq(publishRunBindings.tenantId, config.tenantId),
      eq(publishRunBindings.runId, runId),
      isNull(publishRunBindings.deletedAt)
    )).orderBy(asc(publishRunBindings.createdAt)),
    db.select().from(publishSlotExecutions).where(and(
      eq(publishSlotExecutions.tenantId, config.tenantId),
      eq(publishSlotExecutions.runId, runId),
      isNull(publishSlotExecutions.deletedAt)
    )).orderBy(asc(publishSlotExecutions.businessDate), asc(publishSlotExecutions.slot)),
    db.select().from(publishInterfaceAlerts).where(and(
      eq(publishInterfaceAlerts.tenantId, config.tenantId),
      eq(publishInterfaceAlerts.runId, runId),
      isNull(publishInterfaceAlerts.deletedAt)
    )).orderBy(asc(publishInterfaceAlerts.createdAt))
  ]);
  return { run, bindings, slots, alerts };
}

export async function markInterfacePublishAlertRead(
  alertId: string,
  actor: string,
  readAt = new Date()
) {
  const [alert] = await db.update(publishInterfaceAlerts).set({
    readAt,
    updatedAt: readAt,
    updatedBy: actor
  }).where(and(
    eq(publishInterfaceAlerts.tenantId, config.tenantId),
    eq(publishInterfaceAlerts.id, alertId),
    isNull(publishInterfaceAlerts.deletedAt)
  )).returning();
  if (!alert) throw new Error("INTERFACE_PUBLISH_ALERT_NOT_FOUND");
  return { read: true, alert };
}

export const publishInterfaceMonitorRepository = {
  getRunDetails: getInterfacePublishRunDetails,
  markAlertRead: markInterfacePublishAlertRead
};

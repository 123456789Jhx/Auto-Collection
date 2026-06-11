import { collectorDevices, mobileCommands } from "@pkg/db/schema";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export async function createMobileCommand(values: typeof mobileCommands.$inferInsert) {
  const [command] = await db.insert(mobileCommands).values(values).returning();
  return command;
}

export async function ignorePendingCommandsByDeviceId(deviceId: string, commandTypes: string[], reason: string) {
  if (commandTypes.length === 0) {
    return [];
  }
  const now = new Date();
  return db
    .update(mobileCommands)
    .set({
      status: "IGNORED",
      resultJson: { reason },
      acknowledgedAt: now,
      updatedAt: now,
      updatedBy: "admin"
    })
    .where(
      and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(mobileCommands.deviceId, deviceId),
        inArray(mobileCommands.commandType, commandTypes),
        inArray(mobileCommands.status, ["PENDING", "FETCHED"]),
        isNull(mobileCommands.deletedAt),
        gt(mobileCommands.expiresAt, now)
      )
    )
    .returning();
}

export async function listMobileCommands(limit = 50) {
  return db
    .select()
    .from(mobileCommands)
    .where(and(eq(mobileCommands.tenantId, config.tenantId), isNull(mobileCommands.deletedAt)))
    .orderBy(desc(mobileCommands.createdAt))
    .limit(limit);
}

export async function findPendingCommandsByDeviceId(deviceId: string, limit = 10) {
  const now = new Date();
  return db
    .select()
    .from(mobileCommands)
    .where(
      and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(mobileCommands.deviceId, deviceId),
        inArray(mobileCommands.status, ["PENDING", "FETCHED"]),
        isNull(mobileCommands.deletedAt),
        gt(mobileCommands.expiresAt, now)
      )
    )
    .orderBy(mobileCommands.createdAt)
    .limit(limit);
}

export async function findPendingCommandsByDeviceCode(deviceCode: string, limit = 10) {
  const now = new Date();
  return db
    .select({
      id: mobileCommands.id,
      commandType: mobileCommands.commandType,
      payloadJson: mobileCommands.payloadJson,
      status: mobileCommands.status,
      issuedAt: mobileCommands.issuedAt,
      expiresAt: mobileCommands.expiresAt,
      createdAt: mobileCommands.createdAt
    })
    .from(mobileCommands)
    .innerJoin(collectorDevices, eq(mobileCommands.deviceId, collectorDevices.id))
    .where(
      and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(collectorDevices.tenantId, config.tenantId),
        eq(collectorDevices.deviceCode, deviceCode),
        inArray(mobileCommands.status, ["PENDING", "FETCHED"]),
        isNull(mobileCommands.deletedAt),
        isNull(collectorDevices.deletedAt),
        gt(mobileCommands.expiresAt, now)
      )
    )
    .orderBy(mobileCommands.createdAt)
    .limit(limit);
}

export async function updateMobileCommandStatus(
  commandId: string,
  status: "FETCHED" | "DONE" | "FAILED" | "IGNORED",
  values: Partial<typeof mobileCommands.$inferInsert> = {}
) {
  const patch: Partial<typeof mobileCommands.$inferInsert> = {
    ...values,
    status,
    updatedAt: new Date()
  };
  if (status === "FETCHED") {
    patch.fetchedAt = new Date();
  }
  if (status === "DONE" || status === "FAILED" || status === "IGNORED") {
    patch.acknowledgedAt = new Date();
  }

  const [command] = await db.update(mobileCommands).set(patch).where(eq(mobileCommands.id, commandId)).returning();
  return command;
}

import {
  collectorDevices,
  deviceTaskAssignments,
  publishAccountBindings
} from "@pkg/db/schema";
import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

const TERMINAL_ASSIGNMENT_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "STOPPED",
  "SUPERSEDED",
  "COMPLETED"
];

export type InterfacePublishBindingRow = {
  deviceId: string | null;
  deviceCode: string;
  deviceName: string | null;
  deviceStatus: string;
  lastHeartbeatAt: Date | null;
  bindingId: string | null;
  accountName: string | null;
  accountNo: string | null;
  externalAccountKey: string | null;
  bindingEnabled: boolean | null;
  activeAssignmentId: string | null;
};

export type SaveInterfacePublishBindingInput = {
  deviceCode: string;
  accountName: string;
  accountNo: string;
  externalAccountKey: string;
  enabled: boolean;
  actor: string;
};

export interface InterfacePublishBindingRepository {
  listBindings(): Promise<InterfacePublishBindingRow[]>;
  listActiveBindingsForPreflight(): Promise<InterfacePublishBindingRow[]>;
  findDeviceByCode(deviceCode: string): Promise<InterfacePublishBindingRow | null>;
  saveBinding(input: SaveInterfacePublishBindingInput): Promise<unknown>;
  softDeleteBinding(deviceCode: string, actor: string): Promise<unknown | null>;
}

async function queryDeviceBindings(activeBindingsOnly: boolean) {
  const bindingJoin = [
    eq(publishAccountBindings.tenantId, config.tenantId),
    eq(publishAccountBindings.deviceCode, collectorDevices.deviceCode),
    eq(publishAccountBindings.platform, "DOUYIN"),
    isNull(publishAccountBindings.deletedAt)
  ];
  if (activeBindingsOnly) {
    bindingJoin.push(eq(publishAccountBindings.enabled, true));
  }

  return db.select({
    deviceId: collectorDevices.id,
    deviceCode: collectorDevices.deviceCode,
    deviceName: collectorDevices.deviceName,
    deviceStatus: collectorDevices.status,
    lastHeartbeatAt: collectorDevices.lastHeartbeatAt,
    bindingId: publishAccountBindings.id,
    accountName: publishAccountBindings.accountName,
    accountNo: publishAccountBindings.accountNo,
    externalAccountKey: publishAccountBindings.externalAccountKey,
    bindingEnabled: publishAccountBindings.enabled,
    activeAssignmentId: deviceTaskAssignments.id
  }).from(collectorDevices)
    .leftJoin(publishAccountBindings, and(...bindingJoin))
    .leftJoin(deviceTaskAssignments, and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      eq(deviceTaskAssignments.deviceId, collectorDevices.id),
      isNull(deviceTaskAssignments.deletedAt),
      notInArray(deviceTaskAssignments.status, TERMINAL_ASSIGNMENT_STATUSES)
    ))
    .where(and(
      eq(collectorDevices.tenantId, config.tenantId),
      eq(collectorDevices.enabled, true),
      isNull(collectorDevices.deletedAt)
    ))
    .orderBy(asc(collectorDevices.deviceCode), asc(publishAccountBindings.createdAt));
}

export async function listInterfacePublishBindings() {
  return queryDeviceBindings(false);
}

export async function listActiveInterfacePublishBindingsForPreflight() {
  return queryDeviceBindings(true);
}

export async function findInterfacePublishDeviceByCode(deviceCode: string) {
  const rows = await queryDeviceBindings(false);
  return rows.find((row) => row.deviceCode === deviceCode) ?? null;
}

export async function saveInterfacePublishBinding(input: SaveInterfacePublishBindingInput) {
  const timestamp = new Date();
  const [existing] = await db.select({ id: publishAccountBindings.id })
    .from(publishAccountBindings)
    .where(and(
      eq(publishAccountBindings.tenantId, config.tenantId),
      eq(publishAccountBindings.deviceCode, input.deviceCode),
      eq(publishAccountBindings.platform, "DOUYIN"),
      isNull(publishAccountBindings.deletedAt)
    ))
    .orderBy(asc(publishAccountBindings.createdAt))
    .limit(1);

  if (existing) {
    const [updated] = await db.update(publishAccountBindings).set({
      accountName: input.accountName,
      accountNo: input.accountNo,
      externalAccountKey: input.externalAccountKey,
      enabled: input.enabled,
      updatedAt: timestamp,
      updatedBy: input.actor
    }).where(and(
      eq(publishAccountBindings.tenantId, config.tenantId),
      eq(publishAccountBindings.id, existing.id),
      isNull(publishAccountBindings.deletedAt)
    )).returning();
    if (!updated) throw new Error("INTERFACE_PUBLISH_BINDING_SAVE_FAILED");
    return updated;
  }

  const [created] = await db.insert(publishAccountBindings).values({
    tenantId: config.tenantId,
    deviceCode: input.deviceCode,
    platform: "DOUYIN",
    accountName: input.accountName,
    accountNo: input.accountNo,
    externalAccountKey: input.externalAccountKey,
    enabled: input.enabled,
    createdBy: input.actor,
    updatedBy: input.actor
  }).returning();
  if (!created) throw new Error("INTERFACE_PUBLISH_BINDING_SAVE_FAILED");
  return created;
}

export async function softDeleteInterfacePublishBinding(deviceCode: string, actor: string) {
  const timestamp = new Date();
  const [deleted] = await db.update(publishAccountBindings).set({
    enabled: false,
    deletedAt: timestamp,
    updatedAt: timestamp,
    updatedBy: actor
  }).where(and(
    eq(publishAccountBindings.tenantId, config.tenantId),
    eq(publishAccountBindings.deviceCode, deviceCode),
    eq(publishAccountBindings.platform, "DOUYIN"),
    isNull(publishAccountBindings.deletedAt)
  )).returning({ deviceCode: publishAccountBindings.deviceCode });
  return deleted ?? null;
}

export const interfacePublishBindingRepository: InterfacePublishBindingRepository = {
  listBindings: listInterfacePublishBindings,
  listActiveBindingsForPreflight: listActiveInterfacePublishBindingsForPreflight,
  findDeviceByCode: findInterfacePublishDeviceByCode,
  saveBinding: saveInterfacePublishBinding,
  softDeleteBinding: softDeleteInterfacePublishBinding
};

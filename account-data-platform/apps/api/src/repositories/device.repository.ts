import { collectorDevices } from "@pkg/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export async function findDeviceByCode(deviceCode: string) {
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceCode, deviceCode), isNull(collectorDevices.deletedAt)))
    .limit(1);
  return device ?? null;
}

export async function findDeviceByToken(deviceToken: string) {
  if (!deviceToken) return null;
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceToken, deviceToken), isNull(collectorDevices.deletedAt)))
    .limit(1);
  return device ?? null;
}

export async function updateDeviceRuntimeMetadata(deviceId: string, values: {
  platform?: string;
  appVersion?: string;
  lastIp?: string;
}) {
  const [existing] = await db.select().from(collectorDevices).where(eq(collectorDevices.id, deviceId)).limit(1);
  if (!existing) {
    return null;
  }

  const [updated] = await db
    .update(collectorDevices)
    .set({
      platform: values.platform ?? existing.platform,
      appVersion: values.appVersion ?? existing.appVersion,
      lastIp: values.lastIp ?? existing.lastIp,
      updatedAt: new Date()
    })
    .where(eq(collectorDevices.id, existing.id))
    .returning();
  return updated ?? null;
}

export async function resolveDeviceByToken(values: {
  deviceToken: string;
  platform?: string;
  appVersion?: string;
  lastIp?: string;
}) {
  const device = await findDeviceByToken(values.deviceToken);
  if (!device) {
    throw new Error("DEVICE_UNREGISTERED");
  }
  if (!device.enabled) {
    throw new Error("DEVICE_DISABLED");
  }
  return (await updateDeviceRuntimeMetadata(device.id, values)) ?? device;
}

export async function upsertDevice(deviceCode: string, platform?: string, appVersion?: string, lastIp?: string) {
  const [existing] = await db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceCode, deviceCode), isNull(collectorDevices.deletedAt)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(collectorDevices)
      .set({ platform: platform ?? existing.platform, appVersion: appVersion ?? existing.appVersion, lastIp: lastIp ?? existing.lastIp, updatedAt: new Date() })
      .where(eq(collectorDevices.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(collectorDevices)
    .values({
      tenantId: config.tenantId,
      deviceCode,
      deviceName: deviceCode,
      platform,
      appVersion,
      lastIp,
      status: "offline"
    })
    .returning();
  return created;
}

function tokenSuffix(deviceToken: string, length = 10) {
  return deviceToken.replace(/[^a-zA-Z0-9]/g, "").slice(0, length).toLowerCase() || "unknown";
}

async function allocateDeviceCode(preferredCode: string, deviceToken: string) {
  var normalized = (preferredCode || "").trim();
  if (normalized) {
    var existing = await findDeviceByCode(normalized);
    if (!existing) {
      return normalized;
    }
  }

  var suffix = tokenSuffix(deviceToken, 12);
  var generated = "device_" + suffix;
  var generatedExisting = await findDeviceByCode(generated);
  if (!generatedExisting) {
    return generated;
  }

  for (var index = 2; index <= 99; index += 1) {
    var candidate = generated + "_" + index;
    var candidateExisting = await findDeviceByCode(candidate);
    if (!candidateExisting) {
      return candidate;
    }
  }

  return "device_" + Date.now();
}

export async function upsertDeviceByToken(values: {
  deviceToken: string;
  preferredDeviceCode?: string;
  platform?: string;
  appVersion?: string;
  lastIp?: string;
  deviceName?: string;
}) {
  const existingByToken = await findDeviceByToken(values.deviceToken);
  if (existingByToken) {
    const [updated] = await db
      .update(collectorDevices)
      .set({
        platform: values.platform ?? existingByToken.platform,
        appVersion: values.appVersion ?? existingByToken.appVersion,
        lastIp: values.lastIp ?? existingByToken.lastIp,
        updatedAt: new Date()
      })
      .where(eq(collectorDevices.id, existingByToken.id))
      .returning();
    return updated;
  }

  const deviceCode = await allocateDeviceCode(values.preferredDeviceCode || "", values.deviceToken);
  const suffix = tokenSuffix(values.deviceToken, 8);
  const [created] = await db
    .insert(collectorDevices)
    .values({
      tenantId: config.tenantId,
      deviceCode,
      deviceName: values.deviceName || "设备-" + suffix,
      deviceToken: values.deviceToken,
      platform: values.platform,
      appVersion: values.appVersion,
      lastIp: values.lastIp,
      status: "offline",
      remark: "registered: " + new Date().toISOString()
    })
    .returning();
  return created;
}

export async function registerDeviceByToken(values: {
  deviceToken: string;
  preferredDeviceCode?: string;
  platform?: string;
  appVersion?: string;
  lastIp?: string;
  deviceName?: string;
}) {
  const existingByToken = await findDeviceByToken(values.deviceToken);
  if (existingByToken) {
    return (await updateDeviceRuntimeMetadata(existingByToken.id, values)) ?? existingByToken;
  }

  const preferredCode = (values.preferredDeviceCode || "").trim();
  if (preferredCode) {
    const existingByCode = await findDeviceByCode(preferredCode);
    if (existingByCode) {
      if (existingByCode.deviceToken && existingByCode.deviceToken !== values.deviceToken) {
        throw new Error("DEVICE_TOKEN_CONFLICT");
      }
      const [updated] = await db
        .update(collectorDevices)
        .set({
          deviceToken: values.deviceToken,
          platform: values.platform ?? existingByCode.platform,
          appVersion: values.appVersion ?? existingByCode.appVersion,
          lastIp: values.lastIp ?? existingByCode.lastIp,
          updatedAt: new Date()
        })
        .where(eq(collectorDevices.id, existingByCode.id))
        .returning();
      return updated;
    }
  }

  const deviceCode = await allocateDeviceCode(preferredCode, values.deviceToken);
  const suffix = tokenSuffix(values.deviceToken, 8);
  const [created] = await db
    .insert(collectorDevices)
    .values({
      tenantId: config.tenantId,
      deviceCode,
      deviceName: values.deviceName || "设备-" + suffix,
      deviceToken: values.deviceToken,
      platform: values.platform,
      appVersion: values.appVersion,
      lastIp: values.lastIp,
      status: "offline",
      remark: "registered: " + new Date().toISOString()
    })
    .returning();
  return created;
}

export async function listDevices() {
  return db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), isNull(collectorDevices.deletedAt)))
    .orderBy(asc(collectorDevices.deviceName), asc(collectorDevices.deviceCode), asc(collectorDevices.createdAt));
}

export async function updateDeviceByCode(deviceCode: string, values: Partial<typeof collectorDevices.$inferInsert>) {
  const [device] = await db
    .update(collectorDevices)
    .set({
      ...values,
      updatedAt: new Date(),
      updatedBy: "admin"
    })
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceCode, deviceCode), isNull(collectorDevices.deletedAt)))
    .returning();
  return device ?? null;
}

export async function markDeviceCommandIssued(deviceId: string) {
  await db
    .update(collectorDevices)
    .set({ lastCommandAt: new Date(), updatedAt: new Date() })
    .where(eq(collectorDevices.id, deviceId));
}

export async function countDevices() {
  const devices = await listDevices();
  return devices.length;
}

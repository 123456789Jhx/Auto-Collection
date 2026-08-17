import { createHash } from "node:crypto";
import {
  collectorDevices,
  remoteScriptConfigs,
  remoteScriptDefinitions,
  remoteScriptDeviceBindings
} from "@pkg/db/schema";
import type {
  CreateRemoteScriptConfigPayload,
  RemoteScriptConfigListQuery,
  UpdateRemoteScriptConfigPayload
} from "@pkg/types";
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

type RemoteScriptStatus = "ENABLED" | "DISABLED";

export type UpsertRemoteScriptDefinitionInput = {
  scriptKey: string;
  name: string;
  description?: string | null;
  configSchema: Record<string, unknown>;
  status?: RemoteScriptStatus;
};

function normalizeHashValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeHashValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeHashValue(item)])
    );
  }
  return value;
}

function buildConfigHash(scriptKey: string, payload: Record<string, unknown>, revision: number) {
  const canonicalValue = JSON.stringify([scriptKey, normalizeHashValue(payload), revision]);
  return createHash("sha256").update(canonicalValue).digest("hex");
}

export async function upsertDefinition(
  input: UpsertRemoteScriptDefinitionInput,
  actor = "system"
) {
  const now = new Date();
  const [definition] = await db
    .insert(remoteScriptDefinitions)
    .values({
      tenantId: config.tenantId,
      scriptKey: input.scriptKey,
      name: input.name,
      description: input.description ?? null,
      configSchema: input.configSchema,
      status: input.status ?? "ENABLED",
      createdBy: actor,
      updatedBy: actor
    })
    .onConflictDoUpdate({
      target: [remoteScriptDefinitions.tenantId, remoteScriptDefinitions.scriptKey],
      targetWhere: sql`${remoteScriptDefinitions.deletedAt} is null`,
      set: {
        name: input.name,
        description: input.description ?? null,
        configSchema: input.configSchema,
        status: input.status ?? "ENABLED",
        updatedAt: now,
        updatedBy: actor
      }
    })
    .returning();
  if (!definition) {
    throw new Error("远程脚本类型同步失败");
  }
  return definition;
}

export function listDefinitions() {
  return db
    .select()
    .from(remoteScriptDefinitions)
    .where(and(
      eq(remoteScriptDefinitions.tenantId, config.tenantId),
      isNull(remoteScriptDefinitions.deletedAt)
    ))
    .orderBy(asc(remoteScriptDefinitions.scriptKey));
}

export async function findDefinitionByKey(scriptKey: string) {
  const [definition] = await db
    .select()
    .from(remoteScriptDefinitions)
    .where(and(
      eq(remoteScriptDefinitions.tenantId, config.tenantId),
      eq(remoteScriptDefinitions.scriptKey, scriptKey),
      isNull(remoteScriptDefinitions.deletedAt)
    ))
    .limit(1);
  return definition ?? null;
}

export async function createConfig(
  payload: CreateRemoteScriptConfigPayload,
  actor = "admin"
) {
  const revision = 1;
  const [created] = await db
    .insert(remoteScriptConfigs)
    .values({
      tenantId: config.tenantId,
      scriptKey: payload.scriptKey,
      configName: payload.configName,
      configPayload: payload.configPayload,
      revision,
      configHash: buildConfigHash(payload.scriptKey, payload.configPayload, revision),
      status: payload.status,
      remark: payload.remark ?? null,
      createdBy: actor,
      updatedBy: actor
    })
    .returning();
  if (!created) {
    throw new Error("远程脚本配置创建失败");
  }
  return created;
}

export async function listConfigs(query: RemoteScriptConfigListQuery) {
  const conditions = [
    eq(remoteScriptConfigs.tenantId, config.tenantId),
    isNull(remoteScriptConfigs.deletedAt)
  ];
  if (query.scriptKey) {
    conditions.push(eq(remoteScriptConfigs.scriptKey, query.scriptKey));
  }
  if (query.status) {
    conditions.push(eq(remoteScriptConfigs.status, query.status));
  }
  if (query.keyword) {
    conditions.push(ilike(remoteScriptConfigs.configName, `%${query.keyword}%`));
  }
  if (query.sourceMode === "direct_material") {
    conditions.push(sql`${remoteScriptConfigs.configPayload} ->> 'sourceMode' = 'direct_material'`);
  }
  if (query.sourceMode === "external_pull") {
    conditions.push(sql`coalesce(${remoteScriptConfigs.configPayload} ->> 'sourceMode', 'external_pull') = 'external_pull'`);
  }
  const where = and(...conditions);
  const [data, countRows] = await Promise.all([
    db
      .select()
      .from(remoteScriptConfigs)
      .where(where)
      .orderBy(desc(remoteScriptConfigs.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(remoteScriptConfigs).where(where)
  ]);
  return {
    data,
    page: query.page,
    pageSize: query.pageSize,
    total: Number(countRows[0]?.total ?? 0)
  };
}

export async function findConfigById(id: string) {
  const [savedConfig] = await db
    .select()
    .from(remoteScriptConfigs)
    .where(and(
      eq(remoteScriptConfigs.tenantId, config.tenantId),
      eq(remoteScriptConfigs.id, id),
      isNull(remoteScriptConfigs.deletedAt)
    ))
    .limit(1);
  return savedConfig ?? null;
}

export function updateConfig(
  id: string,
  payload: UpdateRemoteScriptConfigPayload,
  actor = "admin"
) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(remoteScriptConfigs)
      .where(and(
        eq(remoteScriptConfigs.tenantId, config.tenantId),
        eq(remoteScriptConfigs.id, id),
        isNull(remoteScriptConfigs.deletedAt)
      ))
      .limit(1)
      .for("update");
    if (!current) {
      return null;
    }

    const revision = current.revision + 1;
    const configPayload = payload.configPayload ?? current.configPayload;
    const [updated] = await transaction
      .update(remoteScriptConfigs)
      .set({
        configName: payload.configName ?? current.configName,
        configPayload,
        revision,
        configHash: buildConfigHash(current.scriptKey, configPayload, revision),
        status: payload.status ?? current.status,
        remark: payload.remark === undefined ? current.remark : payload.remark,
        updatedAt: new Date(),
        updatedBy: actor
      })
      .where(and(
        eq(remoteScriptConfigs.tenantId, config.tenantId),
        eq(remoteScriptConfigs.id, id),
        isNull(remoteScriptConfigs.deletedAt)
      ))
      .returning();
    return updated ?? null;
  });
}

export async function softDeleteConfig(id: string, actor = "admin") {
  const now = new Date();
  const [deleted] = await db
    .update(remoteScriptConfigs)
    .set({ deletedAt: now, updatedAt: now, updatedBy: actor })
    .where(and(
      eq(remoteScriptConfigs.tenantId, config.tenantId),
      eq(remoteScriptConfigs.id, id),
      isNull(remoteScriptConfigs.deletedAt)
    ))
    .returning();
  return deleted ?? null;
}

export async function getBindingCounts(configIds: string[]) {
  if (configIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ configId: remoteScriptDeviceBindings.configId, total: count() })
    .from(remoteScriptDeviceBindings)
    .where(and(
      eq(remoteScriptDeviceBindings.tenantId, config.tenantId),
      inArray(remoteScriptDeviceBindings.configId, configIds),
      eq(remoteScriptDeviceBindings.enabled, true),
      isNull(remoteScriptDeviceBindings.deletedAt)
    ))
    .groupBy(remoteScriptDeviceBindings.configId);
  return new Map(rows.map((row) => [row.configId, Number(row.total)]));
}

export function listConfigBindings(configId: string) {
  return db
    .select({
      id: remoteScriptDeviceBindings.id,
      configId: remoteScriptDeviceBindings.configId,
      deviceId: remoteScriptDeviceBindings.deviceId,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName,
      priority: remoteScriptDeviceBindings.priority,
      enabled: remoteScriptDeviceBindings.enabled,
      updatedAt: remoteScriptDeviceBindings.updatedAt
    })
    .from(remoteScriptDeviceBindings)
    .innerJoin(collectorDevices, eq(remoteScriptDeviceBindings.deviceId, collectorDevices.id))
    .where(and(
      eq(remoteScriptDeviceBindings.tenantId, config.tenantId),
      eq(remoteScriptDeviceBindings.configId, configId),
      eq(remoteScriptDeviceBindings.enabled, true),
      isNull(remoteScriptDeviceBindings.deletedAt),
      isNull(collectorDevices.deletedAt)
    ))
    .orderBy(asc(remoteScriptDeviceBindings.priority), asc(collectorDevices.deviceCode));
}

export async function saveConfigBinding(
  configId: string,
  deviceId: string,
  priority: number,
  actor: string
) {
  const [current] = await db
    .select()
    .from(remoteScriptDeviceBindings)
    .where(and(
      eq(remoteScriptDeviceBindings.tenantId, config.tenantId),
      eq(remoteScriptDeviceBindings.configId, configId),
      eq(remoteScriptDeviceBindings.deviceId, deviceId),
      isNull(remoteScriptDeviceBindings.deletedAt)
    ))
    .limit(1);
  if (current && current.priority === priority && current.enabled) {
    return current;
  }
  if (current) {
    const [updated] = await db
      .update(remoteScriptDeviceBindings)
      .set({ priority, enabled: true, updatedAt: new Date(), updatedBy: actor })
      .where(eq(remoteScriptDeviceBindings.id, current.id))
      .returning();
    return updated ?? current;
  }
  const [created] = await db
    .insert(remoteScriptDeviceBindings)
    .values({
      tenantId: config.tenantId,
      configId,
      deviceId,
      priority,
      enabled: true,
      createdBy: actor,
      updatedBy: actor
    })
    .returning();
  if (!created) throw new Error("远程脚本设备绑定失败");
  return created;
}

export async function softDeleteConfigBinding(configId: string, deviceId: string, actor: string) {
  const now = new Date();
  const [deleted] = await db
    .update(remoteScriptDeviceBindings)
    .set({ deletedAt: now, updatedAt: now, updatedBy: actor })
    .where(and(
      eq(remoteScriptDeviceBindings.tenantId, config.tenantId),
      eq(remoteScriptDeviceBindings.configId, configId),
      eq(remoteScriptDeviceBindings.deviceId, deviceId),
      isNull(remoteScriptDeviceBindings.deletedAt)
    ))
    .returning();
  return deleted ?? null;
}

export async function findEnabledConfigForDevice(deviceId: string, scriptKey: string) {
  const [savedConfig] = await db
    .select({
      id: remoteScriptConfigs.id,
      scriptKey: remoteScriptConfigs.scriptKey,
      configName: remoteScriptConfigs.configName,
      configPayload: remoteScriptConfigs.configPayload,
      revision: remoteScriptConfigs.revision,
      configHash: remoteScriptConfigs.configHash,
      updatedAt: remoteScriptConfigs.updatedAt
    })
    .from(remoteScriptDeviceBindings)
    .innerJoin(remoteScriptConfigs, eq(remoteScriptDeviceBindings.configId, remoteScriptConfigs.id))
    .where(and(
      eq(remoteScriptDeviceBindings.tenantId, config.tenantId),
      eq(remoteScriptDeviceBindings.deviceId, deviceId),
      eq(remoteScriptDeviceBindings.enabled, true),
      isNull(remoteScriptDeviceBindings.deletedAt),
      eq(remoteScriptConfigs.tenantId, config.tenantId),
      eq(remoteScriptConfigs.scriptKey, scriptKey),
      eq(remoteScriptConfigs.status, "ENABLED"),
      isNull(remoteScriptConfigs.deletedAt)
    ))
    .orderBy(asc(remoteScriptDeviceBindings.priority), desc(remoteScriptConfigs.updatedAt))
    .limit(1);
  return savedConfig ?? null;
}

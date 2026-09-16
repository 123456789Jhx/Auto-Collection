import { collectionTasks, collectorDevices, deviceTaskConfigs, mobileCommands } from "@pkg/db/schema";
import { commentActionTimingSchema, resolveCommentActionTiming, type CommentActionTiming } from "@pkg/types";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class CommentActionTimingNotFoundError extends Error {
  constructor(readonly deviceCode: string) {
    super("COMMENT_ACTION_TIMING_DEVICE_NOT_FOUND");
  }
}

export class CommentActionTimingConflictError extends Error {
  constructor(readonly deviceCode: string, readonly currentUpdatedAt: string | null) {
    super("COMMENT_ACTION_TIMING_REVISION_CONFLICT");
  }
}

export class CommentActionTimingSourceEmptyError extends Error {
  constructor(readonly deviceCode: string) {
    super("COMMENT_ACTION_TIMING_SOURCE_NOT_CONFIGURED");
  }
}

export class CommentActionTimingSourceDisabledError extends Error {
  constructor(readonly deviceCode: string) {
    super("COMMENT_ACTION_TIMING_SOURCE_DISABLED");
  }
}

export class CommentActionTimingTaskNotFoundError extends Error {
  constructor(readonly platform: string) {
    super("COMMENT_ACTION_TIMING_TASK_NOT_FOUND");
  }
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function lockDeviceCodes(transaction: Transaction, deviceCodes: string[]) {
  const sorted = [...new Set(deviceCodes)].sort();
  for (const deviceCode of sorted) {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${config.tenantId}), hashtext(${`comment-timing:${deviceCode}`}))`);
  }
}

async function enabledTask(transaction: Transaction, platform: string) {
  const [task] = await transaction
    .select()
    .from(collectionTasks)
    .where(and(
      eq(collectionTasks.tenantId, config.tenantId),
      eq(collectionTasks.platform, platform),
      eq(collectionTasks.status, "ENABLED"),
      isNull(collectionTasks.deletedAt)
    ))
    .orderBy(desc(collectionTasks.createdAt))
    .limit(1);
  if (!task) throw new CommentActionTimingTaskNotFoundError(platform);
  return task;
}

async function deviceMap(transaction: Transaction, deviceCodes: string[]) {
  const devices = await transaction
    .select()
    .from(collectorDevices)
    .where(and(
      eq(collectorDevices.tenantId, config.tenantId),
      inArray(collectorDevices.deviceCode, deviceCodes),
      isNull(collectorDevices.deletedAt)
    ));
  const byCode = new Map(devices.map((device) => [device.deviceCode, device]));
  for (const deviceCode of deviceCodes) {
    if (!byCode.has(deviceCode)) throw new CommentActionTimingNotFoundError(deviceCode);
  }
  return byCode;
}

async function configMap(transaction: Transaction, taskId: string, deviceIds: string[], forUpdate: boolean) {
  const query = transaction
    .select()
    .from(deviceTaskConfigs)
    .where(and(
      eq(deviceTaskConfigs.tenantId, config.tenantId),
      eq(deviceTaskConfigs.taskId, taskId),
      inArray(deviceTaskConfigs.deviceId, deviceIds),
      isNull(deviceTaskConfigs.deletedAt)
    ));
  const configs = forUpdate ? await query.for("update") : await query;
  return new Map(configs.map((item) => [item.deviceId, item]));
}

function assertVersion(deviceCode: string, current: { updatedAt: Date } | null, expectedUpdatedAt: string | null) {
  const currentUpdatedAt = iso(current?.updatedAt);
  if (currentUpdatedAt !== expectedUpdatedAt) {
    throw new CommentActionTimingConflictError(deviceCode, currentUpdatedAt);
  }
}

function mergeTiming(profile: Record<string, unknown> | null, timing: CommentActionTiming | null) {
  const result = profile && typeof profile === "object" && !Array.isArray(profile) ? { ...profile } : {};
  if (timing) result.commentActionTiming = timing;
  else delete result.commentActionTiming;
  return Object.keys(result).length > 0 ? result : null;
}

async function saveProfile(
  transaction: Transaction,
  task: typeof collectionTasks.$inferSelect,
  device: typeof collectorDevices.$inferSelect,
  current: typeof deviceTaskConfigs.$inferSelect | null,
  profile: Record<string, unknown> | null,
  actor: string,
  now: Date
) {
  if (current) {
    const updatedAt = new Date(Math.max(now.getTime(), current.updatedAt.getTime() + 1));
    const [updated] = await transaction.update(deviceTaskConfigs).set({
      deviceProfile: profile,
      updatedAt,
      updatedBy: actor
    }).where(and(
      eq(deviceTaskConfigs.id, current.id),
      isNull(deviceTaskConfigs.deletedAt)
    )).returning();
    if (!updated) throw new CommentActionTimingConflictError(device.deviceCode, iso(current.updatedAt));
    return updated;
  }
  const [created] = await transaction.insert(deviceTaskConfigs).values({
    tenantId: config.tenantId,
    deviceId: device.id,
    taskId: task.id,
    videoMinutesMin: task.videoMinutesMin,
    videoMinutesMax: task.videoMinutesMax,
    liveMinutesMin: task.liveMinutesMin,
    liveMinutesMax: task.liveMinutesMax,
    autoStart: task.autoStart,
    collectComments: task.collectComments,
    commentLimit: task.commentLimit,
    heartbeatMinutes: task.heartbeatMinutes,
    deviceProfile: profile,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor
  }).returning();
  return created;
}

async function enqueueRefresh(
  transaction: Transaction,
  deviceId: string,
  taskId: string,
  actor: string,
  now: Date,
  payload: Record<string, unknown>
) {
  await transaction.insert(mobileCommands).values({
    tenantId: config.tenantId,
    deviceId,
    taskId,
    commandType: "REFRESH_CONFIG",
    executorType: "AGENT",
    status: "PENDING",
    payloadJson: payload,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000),
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor
  });
}

export async function readCommentActionTimingConfig(deviceCode: string, platform: string) {
  return db.transaction(async (transaction) => {
    const devices = await deviceMap(transaction, [deviceCode]);
    const task = await enabledTask(transaction, platform);
    const device = devices.get(deviceCode)!;
    const configs = await configMap(transaction, task.id, [device.id], false);
    return { task, device, config: configs.get(device.id) ?? null };
  });
}

export async function saveCommentActionTimingAtomic(input: {
  deviceCode: string;
  platform: string;
  expectedUpdatedAt: string | null;
  timing: CommentActionTiming | null;
  actor: string;
}) {
  return db.transaction(async (transaction) => {
    await lockDeviceCodes(transaction, [input.deviceCode]);
    const devices = await deviceMap(transaction, [input.deviceCode]);
    const task = await enabledTask(transaction, input.platform);
    const device = devices.get(input.deviceCode)!;
    const configs = await configMap(transaction, task.id, [device.id], true);
    const current = configs.get(device.id) ?? null;
    assertVersion(input.deviceCode, current, input.expectedUpdatedAt);
    const now = new Date();
    const saved = await saveProfile(transaction, task, device, current, mergeTiming(current?.deviceProfile ?? null, input.timing), input.actor, now);
    await enqueueRefresh(transaction, device.id, task.id, input.actor, now, {
      reason: "comment_action_timing_updated",
      platform: input.platform,
      operation: input.timing ? "save" : "clear",
      updatedAtBefore: iso(current?.updatedAt),
      updatedAtAfter: iso(saved.updatedAt)
    });
    return { task, device, config: saved };
  });
}

export async function saveDeviceProfileBaseAtomic(input: {
  deviceCode: string;
  platform: string;
  expectedUpdatedAt: string | null;
  deviceProfile: Record<string, unknown> | null;
  actor: string;
}) {
  return db.transaction(async (transaction) => {
    await lockDeviceCodes(transaction, [input.deviceCode]);
    const devices = await deviceMap(transaction, [input.deviceCode]);
    const task = await enabledTask(transaction, input.platform);
    const device = devices.get(input.deviceCode)!;
    const configs = await configMap(transaction, task.id, [device.id], true);
    const current = configs.get(device.id) ?? null;
    assertVersion(input.deviceCode, current, input.expectedUpdatedAt);
    const currentProfile = current?.deviceProfile ?? {};
    const nextProfile = input.deviceProfile ? { ...input.deviceProfile } : null;
    const timingChanged = JSON.stringify(currentProfile.commentActionTiming ?? null) !==
      JSON.stringify(nextProfile?.commentActionTiming ?? null);
    const now = new Date();
    const saved = await saveProfile(
      transaction,
      task,
      device,
      current,
      nextProfile,
      input.actor,
      now
    );
    await enqueueRefresh(transaction, device.id, task.id, input.actor, now, {
      reason: timingChanged ? "comment_action_timing_updated" : "device_task_config_updated",
      platform: input.platform,
      operation: input.deviceProfile ? "save_device_profile" : "clear_device_profile",
      updatedAtBefore: iso(current?.updatedAt),
      updatedAtAfter: iso(saved.updatedAt)
    });
    return { task, device, config: saved };
  });
}

export async function copyCommentActionTimingAtomic(input: {
  sourceDeviceCode: string;
  platform: string;
  expectedUpdatedAt: string | null;
  targets: Array<{ deviceCode: string; expectedUpdatedAt: string | null }>;
  actor: string;
}) {
  return db.transaction(async (transaction) => {
    const codes = [input.sourceDeviceCode, ...input.targets.map((target) => target.deviceCode)];
    await lockDeviceCodes(transaction, codes);
    const devices = await deviceMap(transaction, codes);
    const task = await enabledTask(transaction, input.platform);
    const configs = await configMap(transaction, task.id, codes.map((code) => devices.get(code)!.id), true);
    const sourceDevice = devices.get(input.sourceDeviceCode)!;
    const source = configs.get(sourceDevice.id) ?? null;
    assertVersion(input.sourceDeviceCode, source, input.expectedUpdatedAt);
    const sourceProfile = source?.deviceProfile ?? {};
    const parsedSourceTiming = commentActionTimingSchema.safeParse(sourceProfile.commentActionTiming);
    if (!parsedSourceTiming.success) {
      throw new CommentActionTimingSourceEmptyError(input.sourceDeviceCode);
    }
    if (!parsedSourceTiming.data.enabled) {
      throw new CommentActionTimingSourceDisabledError(input.sourceDeviceCode);
    }
    const resolvedTiming = resolveCommentActionTiming(sourceProfile);
    for (const target of input.targets) {
      const device = devices.get(target.deviceCode)!;
      assertVersion(target.deviceCode, configs.get(device.id) ?? null, target.expectedUpdatedAt);
    }

    const now = new Date();
    const results = [];
    for (const target of input.targets) {
      const device = devices.get(target.deviceCode)!;
      const current = configs.get(device.id) ?? null;
      const saved = await saveProfile(transaction, task, device, current, mergeTiming(current?.deviceProfile ?? null, resolvedTiming), input.actor, now);
      await enqueueRefresh(transaction, device.id, task.id, input.actor, now, {
        reason: "comment_action_timing_copied",
        platform: input.platform,
        operation: "copy",
        sourceDeviceCode: input.sourceDeviceCode,
        updatedAtBefore: iso(current?.updatedAt),
        updatedAtAfter: iso(saved.updatedAt)
      });
      results.push({ deviceCode: target.deviceCode, ok: true as const, updatedAt: iso(saved.updatedAt) });
    }
    return { results };
  });
}

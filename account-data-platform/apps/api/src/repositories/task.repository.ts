import { collectionTasks, collectorDevices, deviceTaskConfigs } from "@pkg/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

const defaultSearchKeywords = ["水稻病虫害", "玉米病虫害", "大棚蔬菜"];
const defaultMatchKeywords = ["水稻", "玉米", "小麦", "农业", "农田", "病虫害", "农药", "大棚"];

export async function findCurrentTask(platform: string) {
  const [task] = await db
    .select()
    .from(collectionTasks)
    .where(
      and(
        eq(collectionTasks.tenantId, config.tenantId),
        eq(collectionTasks.platform, platform),
        eq(collectionTasks.status, "ENABLED"),
        isNull(collectionTasks.deletedAt)
      )
    )
    .orderBy(desc(collectionTasks.createdAt))
    .limit(1);

  if (task) {
    return task;
  }

  const [created] = await db
    .insert(collectionTasks)
    .values({
      tenantId: config.tenantId,
      taskCode: "task_agri_interest_default",
      name: "农业兴趣浏览默认任务",
      platform,
      mode: "search",
      searchKeywords: defaultSearchKeywords,
      matchKeywords: defaultMatchKeywords,
      heartbeatMinutes: 1,
      status: "ENABLED"
    })
    .returning();

  return created;
}

export async function findTaskByCode(taskCode: string) {
  const [task] = await db
    .select()
    .from(collectionTasks)
    .where(and(eq(collectionTasks.tenantId, config.tenantId), eq(collectionTasks.taskCode, taskCode), isNull(collectionTasks.deletedAt)))
    .limit(1);
  return task ?? null;
}

export async function listTasks() {
  return db
    .select()
    .from(collectionTasks)
    .where(and(eq(collectionTasks.tenantId, config.tenantId), isNull(collectionTasks.deletedAt)))
    .orderBy(desc(collectionTasks.createdAt));
}

export async function updateTask(taskId: string, values: Partial<typeof collectionTasks.$inferInsert>) {
  const [task] = await db
    .update(collectionTasks)
    .set({
      ...values,
      updatedAt: new Date(),
      updatedBy: "admin"
    })
    .where(and(eq(collectionTasks.tenantId, config.tenantId), eq(collectionTasks.id, taskId), isNull(collectionTasks.deletedAt)))
    .returning();
  return task ?? null;
}

export async function findDeviceTaskConfig(deviceCode: string, platform: string) {
  const task = await findCurrentTask(platform);
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceCode, deviceCode), isNull(collectorDevices.deletedAt)))
    .limit(1);

  if (!device) {
    return { task, device: null, config: null };
  }

  const [deviceConfig] = await db
    .select()
    .from(deviceTaskConfigs)
    .where(
      and(
        eq(deviceTaskConfigs.tenantId, config.tenantId),
        eq(deviceTaskConfigs.deviceId, device.id),
        eq(deviceTaskConfigs.taskId, task.id),
        isNull(deviceTaskConfigs.deletedAt)
      )
    )
    .limit(1);

  return { task, device, config: deviceConfig ?? null };
}

export async function upsertDeviceTaskConfig(deviceCode: string, platform: string, values: Partial<typeof deviceTaskConfigs.$inferInsert>) {
  const task = await findCurrentTask(platform);
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceCode, deviceCode), isNull(collectorDevices.deletedAt)))
    .limit(1);

  if (!device) {
    return null;
  }

  const [existing] = await db
    .select()
    .from(deviceTaskConfigs)
    .where(
      and(
        eq(deviceTaskConfigs.tenantId, config.tenantId),
        eq(deviceTaskConfigs.deviceId, device.id),
        eq(deviceTaskConfigs.taskId, task.id),
        isNull(deviceTaskConfigs.deletedAt)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(deviceTaskConfigs)
      .set({
        ...values,
        updatedAt: new Date(),
        updatedBy: "admin"
      })
      .where(eq(deviceTaskConfigs.id, existing.id))
      .returning();
    return { task, device, config: updated };
  }

  const [created] = await db
    .insert(deviceTaskConfigs)
    .values({
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
      ...values,
      createdBy: "admin",
      updatedBy: "admin"
    })
    .returning();

  return { task, device, config: created };
}

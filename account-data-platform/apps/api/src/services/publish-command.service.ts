import { mobileCommands } from "@pkg/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { config } from "../config";
import { markDeviceCommandIssued } from "../repositories/device.repository";
import { db } from "../repositories/db";

type PublishCommandDatabase = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type PublishCommandTask = {
  id: string;
  matchedDeviceId: string | null;
  title: string;
  description: string;
  coverUrl: string | null;
  videoUrl: string;
};

export type PublishCommandConfig = {
  responseDelayMsMin: number;
  responseDelayMsMax: number;
  actionWaitMsMin: number;
  actionWaitMsMax: number;
  expectedTopicCount: number;
  downloadDir?: string;
};

function commandValues(task: PublishCommandTask, commandConfig: PublishCommandConfig) {
  return {
    taskId: task.id,
    title: task.title,
    description: task.description,
    coverUrl: task.coverUrl,
    videoUrl: task.videoUrl,
    responseDelayMsMin: commandConfig.responseDelayMsMin,
    responseDelayMsMax: commandConfig.responseDelayMsMax,
    actionWaitMsMin: commandConfig.actionWaitMsMin,
    actionWaitMsMax: commandConfig.actionWaitMsMax,
    expectedTopicCount: commandConfig.expectedTopicCount,
    downloadDir: commandConfig.downloadDir ?? ""
  };
}

function keyFor(task: PublishCommandTask) {
  if (!task.matchedDeviceId) throw new Error("PUBLISH_TASK_DEVICE_REQUIRED");
  return `${task.id}:${task.matchedDeviceId}`;
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

export async function createPublishVideoTaskCommand(
  task: PublishCommandTask,
  commandConfig: PublishCommandConfig,
  actor: string,
  database: PublishCommandDatabase = db
) {
  const deviceId = task.matchedDeviceId;
  if (!deviceId) throw new Error("PUBLISH_TASK_DEVICE_REQUIRED");
  const idempotencyKey = keyFor(task);
  const [existing] = await database.select().from(mobileCommands).where(and(
    eq(mobileCommands.tenantId, config.tenantId),
    eq(mobileCommands.idempotencyKey, idempotencyKey),
    isNull(mobileCommands.deletedAt)
  )).limit(1);
  if (existing) return { command: existing, idempotent: true };

  try {
    const now = new Date();
    const [command] = await database.insert(mobileCommands).values({
      tenantId: config.tenantId,
      deviceId,
      idempotencyKey,
      commandType: "PUBLISH_VIDEO_TASK",
      payloadJson: commandValues(task, commandConfig),
      status: "PENDING",
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      createdBy: actor,
      updatedBy: actor
    }).returning();
    if (!command) throw new Error("PUBLISH_COMMAND_CREATE_FAILED");
    await markDeviceCommandIssued(deviceId, database);
    return { command, idempotent: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [raced] = await database.select().from(mobileCommands).where(and(
      eq(mobileCommands.tenantId, config.tenantId),
      eq(mobileCommands.idempotencyKey, idempotencyKey),
      isNull(mobileCommands.deletedAt)
    )).limit(1);
    if (!raced) throw error;
    return { command: raced, idempotent: true };
  }
}

export async function redispatchPublishVideoTaskCommand(
  task: PublishCommandTask,
  commandConfig: PublishCommandConfig,
  actor: string
) {
  const now = new Date();
  const [command] = await db.update(mobileCommands).set({
    payloadJson: commandValues(task, commandConfig),
    status: "PENDING",
    resultJson: null,
    issuedAt: now,
    fetchedAt: null,
    acknowledgedAt: null,
    expiresAt: new Date(now.getTime() + 86_400_000),
    updatedAt: now,
    updatedBy: actor
  }).where(and(
    eq(mobileCommands.tenantId, config.tenantId),
    eq(mobileCommands.idempotencyKey, keyFor(task)),
    isNull(mobileCommands.deletedAt)
  )).returning();
  if (!command) return createPublishVideoTaskCommand(task, commandConfig, actor);
  await markDeviceCommandIssued(task.matchedDeviceId!);
  return { command, idempotent: false };
}

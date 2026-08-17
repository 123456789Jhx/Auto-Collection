import { mobileCommands, publishTasks } from "@pkg/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";
import { markDeviceCommandIssued } from "./device.repository";

export async function saveSingleInterfacePublishTask(input: {
  configId: string;
  externalTaskId: string;
  accountName: string;
  title: string;
  description: string;
  videoUrl: string;
  coverUrl: string;
  deviceId: string;
  rawPayload: Record<string, unknown>;
  actor: string;
  runId: string;
  database?: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
}) {
  const database = input.database ?? db;
  const [task] = await database.insert(publishTasks).values({
    tenantId: config.tenantId,
    configId: input.configId,
    taskId: `single-test:${input.runId}`,
    platform: "DOUYIN",
    accountName: input.accountName,
    title: input.title,
    description: input.description,
    coverUrl: input.coverUrl,
    videoUrl: input.videoUrl,
    status: "CLAIMED",
    source: "SINGLE_INTERFACE_TEST",
    mode: "IMMEDIATE",
    reportMode: "NONE",
    reportStatus: "NOT_REQUIRED",
    matchedDeviceId: input.deviceId,
    rawPayload: input.rawPayload,
    createdBy: input.actor,
    updatedBy: input.actor
  }).returning();
  if (!task) throw new Error("SINGLE_INTERFACE_TASK_CREATE_FAILED");
  return task;
}

export async function createSingleInterfaceMobileCommand(input: {
  deviceId: string;
  idempotencyKey: string;
  commandType: "SINGLE_INTERFACE_PUBLISH_TASK" | "SINGLE_INTERFACE_PUBLISH_STOP";
  payload: Record<string, unknown>;
  actor: string;
  database?: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
}) {
  const database = input.database ?? db;
  const now = new Date();
  const [existing] = await database.select().from(mobileCommands).where(and(
    eq(mobileCommands.tenantId, config.tenantId),
    eq(mobileCommands.idempotencyKey, input.idempotencyKey),
    isNull(mobileCommands.deletedAt)
  )).limit(1);
  if (existing) return existing;
  const [command] = await database.insert(mobileCommands).values({
    tenantId: config.tenantId,
    deviceId: input.deviceId,
    idempotencyKey: input.idempotencyKey,
    commandType: input.commandType,
    payloadJson: input.payload,
    status: "PENDING",
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    createdBy: input.actor,
    updatedBy: input.actor
  }).returning();
  if (!command) throw new Error("SINGLE_INTERFACE_COMMAND_CREATE_FAILED");
  await markDeviceCommandIssued(input.deviceId, database);
  return command;
}

export async function createSingleInterfacePublishDispatch(input: {
  runId: string;
  configId: string;
  externalTaskId: string;
  accountName: string;
  title: string;
  description: string;
  videoUrl: string;
  coverUrl: string;
  deviceId: string;
  rawPayload: Record<string, unknown>;
  commandPayload: Record<string, unknown>;
  commandIdempotencyKey?: string;
  actor: string;
}) {
  return db.transaction(async (transaction) => {
    const task = await saveSingleInterfacePublishTask({ ...input, database: transaction });
    const command = await createSingleInterfaceMobileCommand({
      deviceId: input.deviceId,
      idempotencyKey: input.commandIdempotencyKey ?? `single-interface-publish:${input.runId}`,
      commandType: "SINGLE_INTERFACE_PUBLISH_TASK",
      payload: { ...input.commandPayload, runId: input.runId, taskId: task.id, externalTaskId: input.externalTaskId },
      actor: input.actor,
      database: transaction
    });
    return { task, command };
  });
}

export async function recoverLatestSingleInterfacePublishRun() {
  const [task] = await db.select().from(publishTasks).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.source, "SINGLE_INTERFACE_TEST"),
    isNull(publishTasks.deletedAt)
  )).orderBy(desc(publishTasks.createdAt)).limit(1);
  if (!task) return null;
  const commands = await db.select().from(mobileCommands).where(and(
    eq(mobileCommands.tenantId, config.tenantId),
    eq(mobileCommands.deviceId, task.matchedDeviceId!),
    inArray(mobileCommands.commandType, ["SINGLE_INTERFACE_PUBLISH_TASK", "SINGLE_INTERFACE_PUBLISH_STOP"]),
    isNull(mobileCommands.deletedAt)
  )).orderBy(desc(mobileCommands.createdAt)).limit(100);
  const forTask = commands.filter((command) =>
    (command.payloadJson as { taskId?: unknown } | null)?.taskId === task.id
  );
  return {
    task,
    publishCommand: forTask.find((item) => item.commandType === "SINGLE_INTERFACE_PUBLISH_TASK") ?? null,
    stopCommand: forTask.find((item) => item.commandType === "SINGLE_INTERFACE_PUBLISH_STOP") ?? null
  };
}

export async function inspectSingleInterfacePublishCommand(commandId: string) {
  const [command] = await db.select({ status: mobileCommands.status })
    .from(mobileCommands)
    .where(and(
      eq(mobileCommands.tenantId, config.tenantId),
      eq(mobileCommands.id, commandId),
      isNull(mobileCommands.deletedAt)
    ))
    .limit(1);
  return command ?? null;
}

export async function inspectSingleInterfacePublishTask(taskId: string) {
  const [task] = await db.select({
    status: publishTasks.status,
    resultError: publishTasks.resultError
  }).from(publishTasks).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.id, taskId),
    isNull(publishTasks.deletedAt)
  )).limit(1);
  return task ?? null;
}

export async function cancelPendingSingleInterfacePublishCommand(commandId: string, actor: string) {
  const now = new Date();
  const [command] = await db.update(mobileCommands).set({
    status: "IGNORED",
    resultJson: { reason: "single_interface_publish_stopped_before_fetch" },
    acknowledgedAt: now,
    updatedAt: now,
    updatedBy: actor
  }).where(and(
    eq(mobileCommands.tenantId, config.tenantId),
    eq(mobileCommands.id, commandId),
    eq(mobileCommands.status, "PENDING"),
    isNull(mobileCommands.deletedAt)
  )).returning({ id: mobileCommands.id });
  return Boolean(command);
}

export async function closeCancelledSingleInterfacePublishTask(taskId: string, actor: string) {
  await db.update(publishTasks).set({
    status: "FAILED",
    resultError: "STOPPED_BEFORE_FETCH",
    finishedAt: new Date(),
    updatedAt: new Date(),
    updatedBy: actor
  }).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.id, taskId),
    isNull(publishTasks.deletedAt)
  ));
}

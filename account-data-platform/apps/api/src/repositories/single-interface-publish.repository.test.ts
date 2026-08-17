import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, mobileCommands, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { createSingleInterfacePublishDispatch } from "./single-interface-publish.repository";

const suffix = crypto.randomUUID().replaceAll("-", "");
let configId = "";
let deviceId = "";
const runIds: string[] = [];

function input(runId: string, commandIdempotencyKey?: string) {
  return {
    runId,
    configId,
    externalTaskId: "same-external-material",
    accountName: "勤能致富",
    title: "test material",
    description: "test description",
    videoUrl: "https://media.example.test/video.mp4",
    coverUrl: "https://media.example.test/cover.jpg",
    deviceId,
    rawPayload: { taskId: "same-external-material", runId },
    commandPayload: { runId },
    commandIdempotencyKey,
    actor: "single-interface-test"
  };
}

beforeAll(async () => {
  const [config] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: `single-interface-${suffix}`,
    configPayload: {},
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    status: "ENABLED",
    createdBy: "single-interface-test",
    updatedBy: "single-interface-test"
  }).returning();
  configId = config.id;
  const [device] = await db.insert(collectorDevices).values({
    deviceCode: `single-${suffix.slice(0, 12)}`,
    deviceName: "single interface repository test",
    enabled: true,
    status: "online",
    createdBy: "single-interface-test",
    updatedBy: "single-interface-test"
  }).returning();
  deviceId = device.id;
});

afterAll(async () => {
  if (deviceId) await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
  if (runIds.length) await db.delete(publishTasks).where(inArray(publishTasks.taskId, runIds.map((id) => `single-test:${id}`)));
  if (deviceId) await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
  if (configId) await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, configId));
});

describe("single interface publish repository", () => {
  test("allows repeated test runs for the same external material", async () => {
    const firstRun = crypto.randomUUID();
    const secondRun = crypto.randomUUID();
    runIds.push(firstRun, secondRun);

    const first = await createSingleInterfacePublishDispatch(input(firstRun));
    const second = await createSingleInterfacePublishDispatch(input(secondRun));

    expect(first.task.taskId).toBe(`single-test:${firstRun}`);
    expect(second.task.taskId).toBe(`single-test:${secondRun}`);
    expect(first.task.rawPayload).toMatchObject({ taskId: "same-external-material" });
  });

  test("rolls back the task when dedicated command creation fails", async () => {
    const failedRun = crypto.randomUUID();
    runIds.push(failedRun);
    await expect(createSingleInterfacePublishDispatch(input(failedRun, "x".repeat(161)))).rejects.toThrow();

    const task = await db.query.publishTasks.findFirst({
      where: eq(publishTasks.taskId, `single-test:${failedRun}`)
    });
    expect(task).toBeUndefined();
  });
});

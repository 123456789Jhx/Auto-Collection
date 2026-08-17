import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, mobileCommands, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../repositories/db";
import type { PublishVideoConfig } from "./publish-config";
import { completePublishTaskTopics } from "./publish-task-result.service";
import { dispatchMatchedPublishTask, runPublishSchedulerTick } from "./publish-scheduler.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
const tokenEnv = `PUBLISH_BUSY_TOKEN_${suffix}`;
const actor = "publish-busy-test";
let configId = "";
let deviceId = "";

const publishConfig: PublishVideoConfig = {
  sourceMode: "external_pull",
  externalBaseUrl: "http://wecom.mock.local",
  externalTokenEnv: tokenEnv,
  publishTimeSlots: [],
  platforms: ["\u6296\u97f3", "\u89c6\u9891\u53f7"],
  responseDelayMsMin: 10,
  responseDelayMsMax: 20,
  actionWaitMsMin: 30,
  actionWaitMsMax: 40,
  expectedTopicCount: 2,
  requireCover: false,
  topicResolveTimeoutMinutes: 30,
  isDefault: false,
  downloadDir: "/sdcard/publish-video"
};

async function seedTask(status = "MATCHED", dispatchRetryCount = 0, nextDispatchAt?: Date) {
  const [task] = await db.insert(publishTasks).values({
    configId,
    taskId: `busy-${crypto.randomUUID()}`,
    platform: "DOUYIN",
    accountName: "busy-test-account",
    title: "Busy retry task",
    description: "#one #two",
    coverUrl: "https://media.example.test/busy-cover.jpg",
    videoUrl: "https://media.example.test/busy.mp4",
    status,
    matchedDeviceId: deviceId,
    dispatchRetryCount,
    nextDispatchAt,
    createdBy: actor,
    updatedBy: actor
  }).returning();
  if (!task) throw new Error("PUBLISH_TASK_CREATE_FAILED");
  return task;
}

async function seedActiveCommand(status: "PENDING" | "FETCHED", idempotencyKey = `other-publish-${crypto.randomUUID()}`) {
  await db.insert(mobileCommands).values({
    tenantId: "default",
    deviceId,
    idempotencyKey,
    commandType: "PUBLISH_VIDEO_TASK",
    payloadJson: { taskId: "other-publish-task" },
    status,
    issuedAt: new Date(),
    fetchedAt: status === "FETCHED" ? new Date() : null,
    expiresAt: new Date(Date.now() + 60_000),
    createdBy: actor,
    updatedBy: actor
  });
}

async function getTask(id: string) {
  const [task] = await db.select().from(publishTasks).where(eq(publishTasks.id, id));
  if (!task) throw new Error("PUBLISH_TASK_NOT_FOUND");
  return task;
}

beforeAll(async () => {
  process.env[tokenEnv] = "publish-busy-token";
  const [savedConfig] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: `publish-busy-${suffix}`,
    configPayload: publishConfig,
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: actor,
    updatedBy: actor
  }).returning();
  if (!savedConfig) throw new Error("PUBLISH_CONFIG_CREATE_FAILED");
  configId = savedConfig.id;

  const [device] = await db.insert(collectorDevices).values({
    deviceCode: `publish-busy-${suffix.slice(0, 12)}`,
    enabled: true,
    status: "online",
    lastHeartbeatAt: new Date(),
    accountProfile: { douyinAccountName: "busy-test-account" },
    createdBy: actor,
    updatedBy: actor
  }).returning();
  if (!device) throw new Error("PUBLISH_DEVICE_CREATE_FAILED");
  deviceId = device.id;
});

afterEach(async () => {
  await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
  await db.delete(publishTasks).where(eq(publishTasks.configId, configId));
});

afterAll(async () => {
  await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, configId));
  await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
  delete process.env[tokenEnv];
});

describe("publish busy retry", () => {
  test("treats FETCHED commands as busy and schedules the first retry after five minutes", async () => {
    await seedActiveCommand("FETCHED");
    const task = await seedTask();
    const startedAt = Date.now();

    const result = await dispatchMatchedPublishTask(task, publishConfig, new Date(), actor);

    expect(result.outcome).toBe("PUBLISH_BUSY");
    expect(result.task).toMatchObject({
      status: "PUBLISH_BUSY",
      failureCode: "PUBLISH_BUSY",
      dispatchRetryCount: 1
    });
    expect(result.task.nextDispatchAt?.getTime()).toBeGreaterThanOrEqual(startedAt + 298_000);
    expect(result.task.nextDispatchAt?.getTime()).toBeLessThanOrEqual(Date.now() + 302_000);
  });

  test("waits on retry attempts two and three, then reports PUBLISH_BUSY on the fourth", async () => {
    await seedActiveCommand("PENDING");
    let task = await seedTask("MATCHED", 1);
    const patches: Record<string, unknown>[] = [];
    const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      patches.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ success: true });
    };

    let result = await dispatchMatchedPublishTask(task, publishConfig, new Date(), actor, { fetch });
    expect(result.outcome).toBe("PUBLISH_BUSY");
    expect(result.task.dispatchRetryCount).toBe(2);

    task = await getTask(task.id);
    result = await dispatchMatchedPublishTask(task, publishConfig, new Date(), actor, { fetch }, true);
    expect(result.outcome).toBe("PUBLISH_BUSY");
    expect(result.task.dispatchRetryCount).toBe(3);

    task = await getTask(task.id);
    result = await dispatchMatchedPublishTask(task, publishConfig, new Date(), actor, { fetch }, true);
    expect(result.outcome).toBe("REPORTED");
    expect(result.task).toMatchObject({ status: "REPORTED", resultError: "PUBLISH_BUSY" });
    expect(patches).toEqual([expect.objectContaining({ status: "未发布", error: "PUBLISH_BUSY" })]);
  });

  test("retries due busy work, creates its command when the device is free, and resets retry state", async () => {
    const dueAt = new Date("2026-07-29T00:00:00.000Z");
    const task = await seedTask("PUBLISH_BUSY", 3, dueAt);

    const result = await runPublishSchedulerTick(dueAt);

    expect(result.retried).toHaveLength(1);
    expect(result.retried[0]).toMatchObject({ outcome: "DISPATCHED" });
    const saved = await getTask(task.id);
    expect(saved).toMatchObject({
      status: "DISPATCHED",
      dispatchRetryCount: 0,
      failureCode: null,
      nextDispatchAt: null,
      resultError: null
    });
    const [command] = await db.select().from(mobileCommands).where(and(
      eq(mobileCommands.deviceId, deviceId),
      eq(mobileCommands.idempotencyKey, `${task.id}:${deviceId}`)
    ));
    expect(command).toBeDefined();
  });

  test("topic completion ignores the current task's own fetched command during redispatch", async () => {
    const task = await seedTask("TOPIC_PENDING");
    await seedActiveCommand("FETCHED", `${task.id}:${deviceId}`);

    const result = await completePublishTaskTopics(task.id, "#one #two", actor);

    expect(result).toMatchObject({ status: "DISPATCHED", matchedDeviceId: deviceId });
    const [command] = await db.select().from(mobileCommands).where(eq(
      mobileCommands.idempotencyKey,
      `${task.id}:${deviceId}`
    ));
    expect(command).toMatchObject({ status: "PENDING" });
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, mobileCommands, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import type { ManualPublishTestPayload } from "@pkg/types";
import { eq, inArray } from "drizzle-orm";
import { app } from "../app";
import { db } from "../repositories/db";
import { createManualPublishTest } from "../services/manual-publish-test.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
const deviceCode = `n3-manual-${suffix.slice(0, 12)}`;
let adminToken = "";
let deviceId = "";
let enabledConfigId = "";
let disabledConfigId = "";

const configPayload = {
  externalBaseUrl: "https://wecom.example.test",
  externalTokenEnv: `N3_MANUAL_TOKEN_${suffix}`,
  publishTimeSlots: [],
  responseDelayMsMin: 700,
  responseDelayMsMax: 1300,
  actionWaitMsMin: 900,
  actionWaitMsMax: 1700,
  expectedTopicCount: 5,
  dailyLimitPerAccount: 3,
  downloadDir: "/sdcard/Download/n3-manual"
};

function manualRequest(body: unknown) {
  return app.request("/api/v1/admin/publish-tasks/manual-test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function requestBody(overrides: Partial<ManualPublishTestPayload> = {}): ManualPublishTestPayload {
  return {
    configId: enabledConfigId,
    deviceId,
    platform: "视频号",
    videoUrl: "https://media.example.test/n3-video.mp4",
    coverUrl: null,
    title: "N3 手动测试发布",
    description: "#农业 #丰收 #乡村 #种植 #夏收",
    ...overrides
  };
}

beforeAll(async () => {
  const loginResponse = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: "root" })
  });
  adminToken = (await loginResponse.json()).token;

  const configs = await db.insert(remoteScriptConfigs).values([
    {
      scriptKey: "publish_video",
      configName: `N3 手动测试配置_${suffix}`,
      configPayload,
      configHash: suffix.padEnd(64, "0").slice(0, 64),
      status: "ENABLED",
      createdBy: "n3-test",
      updatedBy: "n3-test"
    },
    {
      scriptKey: "publish_video",
      configName: `N3 停用配置_${suffix}`,
      configPayload,
      configHash: suffix.padEnd(64, "1").slice(0, 64),
      status: "DISABLED",
      createdBy: "n3-test",
      updatedBy: "n3-test"
    }
  ]).returning();
  enabledConfigId = configs[0].id;
  disabledConfigId = configs[1].id;

  const [device] = await db.insert(collectorDevices).values({
    deviceCode,
    deviceName: "N3 手动测试设备",
    enabled: true,
    status: "online",
    createdBy: "n3-test",
    updatedBy: "n3-test"
  }).returning();
  deviceId = device.id;
});

afterAll(async () => {
  if (deviceId) await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
  if (enabledConfigId) await db.delete(publishTasks).where(eq(publishTasks.configId, enabledConfigId));
  if (enabledConfigId && disabledConfigId) {
    await db.delete(remoteScriptConfigs).where(inArray(remoteScriptConfigs.id, [enabledConfigId, disabledConfigId]));
  }
  if (deviceId) await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
});

describe("POST /admin/publish-tasks/manual-test", () => {
  test("persists a dispatched manual task and creates the reusable publish command", async () => {
    const response = await manualRequest(requestBody());
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.idempotent).toBeFalse();
    expect(result.task.taskId).toStartWith("manual-");
    expect(result.task).toMatchObject({
      configId: enabledConfigId,
      matchedDeviceId: deviceId,
      platform: "WECHAT_CHANNELS",
      accountName: "",
      status: "DISPATCHED",
      title: "N3 手动测试发布",
      coverUrl: null
    });
    expect(result.task.dispatchedAt).toBeString();
    expect(result.command).toMatchObject({
      deviceId,
      commandType: "PUBLISH_VIDEO_TASK",
      status: "PENDING"
    });

    const task = await db.query.publishTasks.findFirst({
      where: eq(publishTasks.id, result.task.id)
    });
    expect(task).toMatchObject({
      taskId: result.task.taskId,
      configId: enabledConfigId,
      matchedDeviceId: deviceId,
      platform: "WECHAT_CHANNELS",
      accountName: "",
      status: "DISPATCHED",
      videoUrl: "https://media.example.test/n3-video.mp4",
      coverUrl: null
    });
    expect(task?.dispatchedAt).toBeInstanceOf(Date);

    const command = await db.query.mobileCommands.findFirst({
      where: eq(mobileCommands.id, result.command.id)
    });
    expect(command?.payloadJson).toMatchObject({
      taskId: result.task.id,
      videoUrl: "https://media.example.test/n3-video.mp4",
      responseDelayMsMin: 700,
      responseDelayMsMax: 1300,
      actionWaitMsMin: 900,
      actionWaitMsMax: 1700,
      expectedTopicCount: 5,
      downloadDir: "/sdcard/Download/n3-manual"
    });
  });

  test("rejects a disabled publish configuration", async () => {
    const response = await manualRequest(requestBody({ configId: disabledConfigId }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("PUBLISH_CONFIG_NOT_ENABLED");
  });

  test("rolls back the task when command creation fails", async () => {
    const title = `N3 回滚测试_${suffix}`;
    await expect(createManualPublishTest(requestBody({ title }), "n3-test", {
      createCommand: async () => {
        throw new Error("COMMAND_CREATE_FAILED");
      }
    })).rejects.toThrow("COMMAND_CREATE_FAILED");
    const rows = await db.query.publishTasks.findMany({ where: eq(publishTasks.title, title) });
    expect(rows).toHaveLength(0);
  });

  test("rejects a missing device", async () => {
    const response = await manualRequest(requestBody({ deviceId: crypto.randomUUID() }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("PUBLISH_DEVICE_NOT_FOUND");
  });

  test("returns 400 for invalid request parameters", async () => {
    const response = await manualRequest({ ...requestBody(), platform: "快手", title: "" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

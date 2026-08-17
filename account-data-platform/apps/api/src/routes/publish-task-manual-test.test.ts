import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, mobileCommands, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import type { ManualPublishTestPayload } from "@pkg/types";
import { eq, inArray } from "drizzle-orm";
import { app } from "../app";
import { db } from "../repositories/db";
import { createManualPublishTest } from "../services/manual-publish-test.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
const deviceCode = `n3-manual-${suffix.slice(0, 12)}`;
const deviceToken = `${suffix}${suffix}`;
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
  topicResolveTimeoutMinutes: 30,
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
    coverUrl: "https://media.example.test/n3-cover.jpg",
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
    deviceToken,
    enabled: true,
    status: "online",
    lastHeartbeatAt: new Date(),
    accountProfile: {
      douyinAccountName: "N5B路由账号",
      wechatChannelsName: "N5B路由视频号"
    },
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
      source: "MANUAL_TEST",
      mode: "IMMEDIATE",
      reportMode: "NONE",
      reportStatus: "NOT_REQUIRED",
      title: "N3 手动测试发布",
      coverUrl: "https://media.example.test/n3-cover.jpg"
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
      source: "MANUAL_TEST",
      mode: "IMMEDIATE",
      reportMode: "NONE",
      reportStatus: "NOT_REQUIRED",
      videoUrl: "https://media.example.test/n3-video.mp4",
      coverUrl: "https://media.example.test/n3-cover.jpg"
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
      topicResolveTimeoutMinutes: 30,
      platform: "WECHAT_CHANNELS",
      downloadDir: "/sdcard/Download/n3-manual"
    });
  });

  test("persists QUICK_PASTE through the existing manual-test endpoint", async () => {
    const response = await manualRequest({ ...requestBody(), source: "QUICK_PASTE" });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.task).toMatchObject({
      source: "QUICK_PASTE",
      mode: "IMMEDIATE",
      reportMode: "NONE",
      reportStatus: "NOT_REQUIRED"
    });

    const task = await db.query.publishTasks.findFirst({
      where: eq(publishTasks.id, result.task.id)
    });
    expect(task).toMatchObject({
      source: "QUICK_PASTE",
      mode: "IMMEDIATE",
      reportMode: "NONE",
      reportStatus: "NOT_REQUIRED"
    });
  });


  test("rejects a manual task without a cover URL", async () => {
    const payload: Record<string, unknown> = { ...requestBody() };
    delete payload.coverUrl;
    const response = await manualRequest(payload);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
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

  test("rejects an external source through the manual-test endpoint", async () => {
    const response = await manualRequest({ ...requestBody(), source: "EXTERNAL_PULL" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects incomplete topic repair and dispatches after valid repair", async () => {
    await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
    await db.delete(publishTasks).where(eq(publishTasks.configId, enabledConfigId));
    const [task] = await db.insert(publishTasks).values({
      configId: enabledConfigId,
      taskId: `n5b-topics-route-${suffix}`,
      platform: "DOUYIN",
      accountName: "N5B路由账号",
      title: "N5B 话题补全路由",
      description: "只有 #一个",
      coverUrl: "https://media.example.test/n5b-topic-cover.jpg",
      videoUrl: "https://media.example.test/n5b-topic.mp4",
      status: "TOPIC_PENDING",
      matchedDeviceId: deviceId,
      matchNote: "应有5个#，实际1个"
    }).returning();
    const requestTopics = (description: string) => app.request(
      `/api/v1/admin/publish-tasks/${task.id}/topics`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ description })
      }
    );

    const invalid = await requestTopics("仍然只有 #一 #二 #三 #四");
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.message).toBe("应有5个#，实际4个");

    const pendingQuery = await app.request(
      `/api/v1/mobile/publish-tasks/${task.id}/topics?deviceId=${deviceCode}`,
      { headers: { "X-Device-Token": deviceToken } }
    );
    expect(pendingQuery.status).toBe(200);
    expect(await pendingQuery.json()).toMatchObject({ resolved: false, status: "TOPIC_PENDING" });

    const valid = await requestTopics("补全完成 #一 #二 #三 #四 #五");
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ status: "DISPATCHED", matchedDeviceId: deviceId });
    const commands = await db.select().from(mobileCommands).where(eq(
      mobileCommands.idempotencyKey,
      `${task.id}:${deviceId}`
    ));
    expect(commands).toHaveLength(1);

    const resolvedQuery = await app.request(
      `/api/v1/mobile/publish-tasks/${task.id}/topics?deviceId=${deviceCode}`,
      { headers: { "X-Device-Token": deviceToken } }
    );
    expect(resolvedQuery.status).toBe(200);
    expect(await resolvedQuery.json()).toMatchObject({
      resolved: true,
      status: "DISPATCHED",
      description: "补全完成 #一 #二 #三 #四 #五"
    });
  });
});

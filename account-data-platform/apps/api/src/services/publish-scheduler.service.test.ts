import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, mobileCommands, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import type { WecomPublishTask } from "@pkg/types";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../repositories/db";
import { dispatchPublishConfigNow } from "./publish-scheduler.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
const tokenEnv = `NODE12_SCHEDULER_TOKEN_${suffix}`;
const deviceCode = `node12-scheduler-${suffix.slice(0, 10)}`;
let configId = "";
let deviceId = "";

function externalTask(taskId: string, accountName: string): WecomPublishTask {
  return {
    taskId,
    accountName,
    title: `发布任务 ${taskId}`,
    description: "#丰收 #乡村",
    coverUrl: "https://media.example.test/cover.jpg",
    videoUrl: "https://media.example.test/video.mp4",
    platform: "抖音",
    status: "待发布"
  };
}

function mockFetch(tasks: WecomPublishTask[], patches: unknown[]) {
  let claimIndex = 0;
  return async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return Response.json({ success: true });
    }
    return Response.json({ data: tasks[claimIndex++] ?? null });
  };
}

beforeAll(async () => {
  process.env[tokenEnv] = "node12-test-token";
  const [savedConfig] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: `节点12调度配置_${suffix}`,
    configPayload: {
      externalBaseUrl: "http://wecom.mock.local",
      externalTokenEnv: tokenEnv,
      publishTimeSlots: ["09:30"],
      responseDelayMsMin: 800,
      responseDelayMsMax: 1600,
      actionWaitMsMin: 1200,
      actionWaitMsMax: 2400,
      expectedTopicCount: 2,
      dailyLimitPerAccount: 3,
      downloadDir: "/sdcard/Download/publish-video"
    },
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: "node12-test",
    updatedBy: "node12-test"
  }).returning();
  configId = savedConfig.id;

  const [device] = await db.insert(collectorDevices).values({
    deviceCode,
    deviceName: "节点12虚拟设备",
    enabled: true,
    status: "online",
    lastHeartbeatAt: new Date(),
    accountProfile: {
      douyinAccountId: "node12-account",
      douyinAccountName: "节点12命中号",
      wechatChannelsName: ""
    },
    createdBy: "node12-test",
    updatedBy: "node12-test"
  }).returning();
  deviceId = device.id;
});

afterAll(async () => {
  await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
  await db.delete(publishTasks).where(eq(publishTasks.configId, configId));
  await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, configId));
  await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
  delete process.env[tokenEnv];
});

describe("publish scheduler", () => {
  test("dispatches a matched task with the complete mobile payload", async () => {
    const patches: unknown[] = [];
    const result = await dispatchPublishConfigNow(configId, "node12-test", {
      fetch: mockFetch([externalTask(`matched-${suffix}`, "节点12命中号")], patches),
      logger: () => undefined,
      scheduledSlot: new Date("2026-07-28T01:30:00.000Z")
    });

    expect(result).toMatchObject({ dispatched: 1, reported: 0 });
    const [task] = await db.select().from(publishTasks).where(and(
      eq(publishTasks.configId, configId),
      eq(publishTasks.taskId, `matched-${suffix}`)
    ));
    expect(task.status).toBe("DISPATCHED");
    expect(task.dispatchedAt).toBeInstanceOf(Date);

    const [command] = await db.select().from(mobileCommands).where(and(
      eq(mobileCommands.deviceId, deviceId),
      eq(mobileCommands.commandType, "PUBLISH_VIDEO_TASK")
    ));
    expect(command.idempotencyKey).toBe(`${task.id}:${deviceId}`);
    expect(command.payloadJson).toMatchObject({
      taskId: task.id,
      title: task.title,
      description: "#丰收 #乡村",
      coverUrl: "https://media.example.test/cover.jpg",
      videoUrl: "https://media.example.test/video.mp4",
      responseDelayMsMin: 800,
      responseDelayMsMax: 1600,
      actionWaitMsMin: 1200,
      actionWaitMsMax: 2400,
      expectedTopicCount: 2,
      downloadDir: "/sdcard/Download/publish-video"
    });
    expect(patches).toHaveLength(0);
  });

  test("reports an unmatched claimed task as unpublished", async () => {
    const patches: unknown[] = [];
    const result = await dispatchPublishConfigNow(configId, "node12-test", {
      fetch: mockFetch([externalTask(`unmatched-${suffix}`, "没有绑定的账号")], patches),
      logger: () => undefined,
      scheduledSlot: new Date("2026-07-28T02:30:00.000Z")
    });

    expect(result).toMatchObject({ dispatched: 0, reported: 1 });
    const [task] = await db.select().from(publishTasks).where(and(
      eq(publishTasks.configId, configId),
      eq(publishTasks.taskId, `unmatched-${suffix}`),
      inArray(publishTasks.status, ["REPORTED"])
    ));
    expect(task.resultError).toBe("无绑定该抖音号的设备：没有绑定的账号");
    expect(task.reportedAt).toBeInstanceOf(Date);
    expect(patches).toEqual([{
      platform: "抖音",
      status: "未发布",
      error: "无绑定该抖音号的设备：没有绑定的账号"
    }]);
  });
});

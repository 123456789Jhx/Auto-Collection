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

function externalTask(
  taskId: string,
  accountName: string | null,
  platform: "抖音" | "视频号" = "抖音",
  description = "#丰收 #乡村"
): WecomPublishTask {
  return {
    taskId,
    accountName,
    title: `发布任务 ${taskId}`,
    description,
    coverUrl: "https://media.example.test/cover.jpg",
    videoUrl: "https://media.example.test/video.mp4",
    platform,
    status: "待发布"
  };
}

function mockFetch(
  tasks: WecomPublishTask[] | Record<"抖音" | "视频号", WecomPublishTask[]>,
  patches: unknown[]
) {
  const queues = Array.isArray(tasks) ? { 抖音: tasks, 视频号: [] } : tasks;
  const indexes = { 抖音: 0, 视频号: 0 };
  return async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return Response.json({ success: true });
    }
    const body = JSON.parse(String(init?.body || "{}")) as { platform?: "抖音" | "视频号" };
    const platform = body.platform ?? "抖音";
    return Response.json({ data: queues[platform][indexes[platform]++] ?? null });
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
      wechatChannelsName: "节点12视频号"
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

  test("dispatches three tasks for the same account without a daily cap", async () => {
    const ids = [1, 2, 3].map((index) => `no-limit-${index}-${suffix}`);
    const result = await dispatchPublishConfigNow(configId, "node12-test", {
      fetch: mockFetch(ids.map((id) => externalTask(id, "节点12命中号")), []),
      logger: () => undefined,
      scheduledSlot: new Date("2026-07-28T03:30:00.000Z")
    });

    expect(result).toMatchObject({ dispatched: 3, reported: 0 });
    const tasks = await db.select().from(publishTasks).where(inArray(publishTasks.taskId, ids));
    expect(tasks).toHaveLength(3);
    expect(tasks.every((task) => task.status === "DISPATCHED")).toBeTrue();
  });

  test("drains douyin before wechat channels in the same slot", async () => {
    const douyinId = `priority-douyin-${suffix}`;
    const channelsId = `priority-channels-${suffix}`;
    const result = await dispatchPublishConfigNow(configId, "node12-test", {
      fetch: mockFetch({
        抖音: [externalTask(douyinId, "节点12命中号", "抖音")],
        视频号: [externalTask(channelsId, "节点12命中号", "视频号")]
      }, []),
      logger: () => undefined,
      scheduledSlot: new Date("2026-07-28T04:30:00.000Z")
    });

    expect(result).toMatchObject({ dispatched: 2, reported: 0 });
    const tasks = await db.select().from(publishTasks).where(inArray(
      publishTasks.taskId,
      [douyinId, channelsId]
    ));
    const douyinTask = tasks.find((task) => task.taskId === douyinId)!;
    const channelsTask = tasks.find((task) => task.taskId === channelsId)!;
    const commands = await db.select().from(mobileCommands).where(inArray(
      mobileCommands.idempotencyKey,
      [`${douyinTask.id}:${deviceId}`, `${channelsTask.id}:${deviceId}`]
    ));
    const douyinCommand = commands.find((command) => command.idempotencyKey?.startsWith(douyinTask.id))!;
    const channelsCommand = commands.find((command) => command.idempotencyKey?.startsWith(channelsTask.id))!;
    expect(douyinCommand.issuedAt.getTime()).toBeLessThanOrEqual(channelsCommand.issuedAt.getTime());
    expect(douyinCommand.payloadJson).toMatchObject({ platform: "DOUYIN" });
    expect(channelsCommand.payloadJson).toMatchObject({ platform: "WECHAT_CHANNELS" });
  });

  test("reports a matched channels task when the device has no channels binding", async () => {
    await db.update(collectorDevices).set({
      accountProfile: { douyinAccountName: "节点12命中号", wechatChannelsName: "" }
    }).where(eq(collectorDevices.id, deviceId));
    const taskId = `channels-no-binding-${suffix}`;
    const patches: unknown[] = [];
    try {
      const result = await dispatchPublishConfigNow(configId, "node12-test", {
        fetch: mockFetch({ 抖音: [], 视频号: [externalTask(taskId, "节点12命中号", "视频号")] }, patches),
        logger: () => undefined,
        scheduledSlot: new Date("2026-07-28T05:30:00.000Z")
      });
      expect(result).toMatchObject({ dispatched: 0, reported: 1 });
      const [task] = await db.select().from(publishTasks).where(eq(publishTasks.taskId, taskId));
      expect(task).toMatchObject({ status: "REPORTED", resultError: "未发布：该设备未绑定视频号" });
      const commands = await db.select().from(mobileCommands).where(eq(
        mobileCommands.idempotencyKey,
        `${task.id}:${deviceId}`
      ));
      expect(commands).toHaveLength(0);
      expect(patches).toEqual([{ platform: "视频号", status: "未发布", error: "未发布：该设备未绑定视频号" }]);
    } finally {
      await db.update(collectorDevices).set({
        accountProfile: { douyinAccountName: "节点12命中号", wechatChannelsName: "节点12视频号" }
      }).where(eq(collectorDevices.id, deviceId));
    }
  });

  test("requires an account name for a channels task", async () => {
    const taskId = `channels-null-account-${suffix}`;
    const patches: unknown[] = [];
    const result = await dispatchPublishConfigNow(configId, "node12-test", {
      fetch: mockFetch({ 抖音: [], 视频号: [externalTask(taskId, null, "视频号")] }, patches),
      logger: () => undefined,
      scheduledSlot: new Date("2026-07-28T06:30:00.000Z")
    });

    expect(result).toMatchObject({ dispatched: 0, reported: 1 });
    const [task] = await db.select().from(publishTasks).where(eq(publishTasks.taskId, taskId));
    expect(task).toMatchObject({
      status: "REPORTED",
      matchedDeviceId: null,
      resultError: "视频号任务必须指定账号并绑定视频号"
    });
    expect(patches).toEqual([{
      platform: "视频号",
      status: "未发布",
      error: "视频号任务必须指定账号并绑定视频号"
    }]);
  });

  test("keeps invalid topics pending before matching and command creation", async () => {
    const taskId = `topics-pending-${suffix}`;
    const result = await dispatchPublishConfigNow(configId, "node12-test", {
      fetch: mockFetch([externalTask(taskId, "节点12命中号", "抖音", "只有 #一个")], []),
      logger: () => undefined,
      scheduledSlot: new Date("2026-07-28T07:30:00.000Z")
    });

    expect(result).toMatchObject({ dispatched: 0, reported: 0 });
    const [task] = await db.select().from(publishTasks).where(eq(publishTasks.taskId, taskId));
    expect(task).toMatchObject({
      status: "TOPIC_PENDING",
      matchedDeviceId: null,
      matchNote: "应有2个#，实际1个",
      scheduledSlot: new Date("2026-07-28T07:30:00.000Z")
    });
    const commands = await db.select().from(mobileCommands).where(eq(
      mobileCommands.idempotencyKey,
      `${task.id}:${deviceId}`
    ));
    expect(commands).toHaveLength(0);
  });
});

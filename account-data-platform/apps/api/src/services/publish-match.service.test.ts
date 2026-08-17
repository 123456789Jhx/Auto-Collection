import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  collectorDevices,
  publishTasks,
  remoteScriptConfigs
} from "@pkg/db/schema";
import type { WecomPublishTask } from "@pkg/types";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "../repositories/db";
import { claimAndMatchPublishTask } from "./publish-match.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
const tokenEnv = `NODE11_MATCH_TOKEN_${suffix}`;
const matchedDeviceCode = `node11-match-${suffix.slice(0, 12)}`;
const newerMatchedDeviceCode = `node11-newer-${suffix.slice(0, 12)}`;
const disabledDeviceCode = `node11-disabled-${suffix.slice(0, 12)}`;
const recentUnboundDeviceCode = `node11-unbound-a-${suffix.slice(0, 10)}`;
const olderUnboundDeviceCode = `node11-unbound-b-${suffix.slice(0, 10)}`;
const offlineUnboundDeviceCode = `node11-offline-${suffix.slice(0, 12)}`;
const channelMatchedDeviceCode = "node11-channel-" + suffix.slice(0, 12);
const channelMisleadingDeviceCode = "node11-channel-douyin-" + suffix.slice(0, 10);
const channelUnsupportedDeviceCode = "node11-channel-unsupported-" + suffix.slice(0, 10);
let configId = "";
let matchedDeviceId = "";
let newerMatchedDeviceId = "";
let channelMatchedDeviceId = "";
let channelUnsupportedDeviceId = "";

const baseTask = {
  title: "节点11发布任务",
  description: "外部接口匹配测试 #农业",
  coverUrl: "https://media.example.test/node11-cover.jpg",
  videoUrl: "https://media.example.test/node11.mp4",
  platform: "抖音",
  status: "待发布",
  taskId: `draft-${suffix}`,
  accountName: "测试号001"
} satisfies WecomPublishTask;

function fetchTask(task: WecomPublishTask | null) {
  return async () => new Response(JSON.stringify({ data: task }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

beforeAll(async () => {
  process.env[tokenEnv] = "node11-match-secret";
  const [config] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: `节点11匹配配置_${suffix}`,
    configPayload: {
      externalBaseUrl: "http://wecom.mock.local",
      externalTokenEnv: tokenEnv,
      publishTimeSlots: [],
      responseDelayMsMin: 10,
      responseDelayMsMax: 20,
      actionWaitMsMin: 30,
      actionWaitMsMax: 40,
      expectedTopicCount: 1
    },
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: "node11-test",
    updatedBy: "node11-test"
  }).returning();
  configId = config.id;

  const heartbeatNow = new Date();
  const devices = await db.insert(collectorDevices).values([
    {
      deviceCode: matchedDeviceCode,
      deviceName: "节点11最早绑定设备",
      enabled: true,
      status: "online",
      lastHeartbeatAt: heartbeatNow,
      updatedAt: new Date(heartbeatNow.getTime() - 120_000),
      accountProfile: {
        douyinAccountId: "test-001",
        douyinAccountName: "测试号001",
        wechatChannelsName: "视频号测试01"
      },
      createdBy: "node11-test",
      updatedBy: "node11-test"
    },
    {
      deviceCode: newerMatchedDeviceCode,
      deviceName: "节点11较晚绑定设备",
      enabled: true,
      status: "running",
      lastHeartbeatAt: heartbeatNow,
      updatedAt: new Date(heartbeatNow.getTime() - 60_000),
      accountProfile: {
        douyinAccountId: "test-001-newer",
        douyinAccountName: "测试号001",
        wechatChannelsName: ""
      },
      createdBy: "node11-test",
      updatedBy: "node11-test"
    },
    {
      deviceCode: disabledDeviceCode,
      deviceName: "节点11禁用设备",
      enabled: false,
      status: "online",
      lastHeartbeatAt: heartbeatNow,
      accountProfile: {
        douyinAccountId: "disabled-001",
        douyinAccountName: "禁用号",
        wechatChannelsName: ""
      },
      createdBy: "node11-test",
      updatedBy: "node11-test"
    },
    {
      deviceCode: recentUnboundDeviceCode,
      deviceName: "节点11最近心跳未绑定设备",
      enabled: true,
      status: "idle",
      lastHeartbeatAt: heartbeatNow,
      accountProfile: {},
      createdBy: "node11-test",
      updatedBy: "node11-test"
    },
    {
      deviceCode: olderUnboundDeviceCode,
      deviceName: "节点11较早心跳未绑定设备",
      enabled: true,
      status: "idle",
      lastHeartbeatAt: new Date(heartbeatNow.getTime() - 60_000),
      accountProfile: { wechatChannelsName: "仅记录" },
      createdBy: "node11-test",
      updatedBy: "node11-test"
    },
    {
      deviceCode: offlineUnboundDeviceCode,
      deviceName: "节点11离线未绑定设备",
      enabled: true,
      status: "offline",
      lastHeartbeatAt: new Date(heartbeatNow.getTime() - 10 * 60_000),
      accountProfile: {},
      createdBy: "node11-test",
      updatedBy: "node11-test"
    },
    {
      deviceCode: channelMatchedDeviceCode,
      deviceName: "节点11视频号绑定设备",
      enabled: true,
      status: "online",
      lastHeartbeatAt: heartbeatNow,
      accountProfile: {
        douyinAccountName: "不同的抖音号",
        wechatChannelsName: "视频号测试01"
      },
      createdBy: "node11-test",
      updatedBy: "node11-test"
    },
    {
      deviceCode: channelMisleadingDeviceCode,
      deviceName: "节点11仅视频号同名设备",
      enabled: true,
      status: "online",
      lastHeartbeatAt: heartbeatNow,
      accountProfile: {
        douyinAccountName: "另一个抖音号",
        wechatChannelsName: "视频号测试01"
      },
      createdBy: "node11-test",
      updatedBy: "node11-test"
    },
    {
      deviceCode: channelUnsupportedDeviceCode,
      deviceName: "节点11未绑定视频号设备",
      enabled: true,
      status: "online",
      lastHeartbeatAt: heartbeatNow,
      accountProfile: {
        douyinAccountId: "channels-unsupported-id",
        douyinAccountName: "缺视频号能力",
        wechatChannelsName: ""
      },
      createdBy: "node11-test",
      updatedBy: "node11-test"
    }
  ]).returning();
  matchedDeviceId = devices[0].id;
  newerMatchedDeviceId = devices[1].id;
  channelMatchedDeviceId = devices[6].id;
  channelUnsupportedDeviceId = devices[8].id;
});

afterAll(async () => {
  if (configId) {
    await db.delete(publishTasks).where(eq(publishTasks.configId, configId));
    await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, configId));
  }
  await db.delete(collectorDevices).where(inArray(collectorDevices.deviceCode, [
    matchedDeviceCode,
    newerMatchedDeviceCode,
    disabledDeviceCode,
    recentUnboundDeviceCode,
    olderUnboundDeviceCode,
    offlineUnboundDeviceCode,
    channelMatchedDeviceCode,
    channelMisleadingDeviceCode,
    channelUnsupportedDeviceCode
  ]));
  delete process.env[tokenEnv];
});

describe("publish task matching", () => {
  test("trims an account name and chooses the earliest updated online binding idempotently", async () => {
    const task = { ...baseTask, accountName: "  测试号001  " };
    const first = await claimAndMatchPublishTask(configId, "node11-test", {
      accountName: "测试号001",
      fetch: fetchTask(task),
      logger: () => undefined
    });
    const repeated = await claimAndMatchPublishTask(configId, "node11-test", {
      accountName: "测试号001",
      fetch: fetchTask(task),
      logger: () => undefined
    });

    expect(first.task?.status).toBe("MATCHED");
    expect(first.task?.matchedDeviceId).toBe(matchedDeviceId);
    expect(first.task?.matchedDeviceId).not.toBe(newerMatchedDeviceId);
    expect(first.task?.accountName).toBe("测试号001");
    expect(first.created).toBeTrue();
    expect(repeated.task?.id).toBe(first.task?.id);
    expect(repeated.created).toBeFalse();

    const [result] = await db.select({ value: count() }).from(publishTasks).where(and(
      eq(publishTasks.platform, "DOUYIN"),
      eq(publishTasks.taskId, baseTask.taskId)
    ));
    expect(result.value).toBe(1);
  });

  test("stores unmatched tasks with the required note", async () => {
    const result = await claimAndMatchPublishTask(configId, "node11-test", {
      accountName: "测试号001",
      fetch: fetchTask({ ...baseTask, taskId: `${baseTask.taskId}-unmatched`, accountName: "禁用号" }),
      logger: () => undefined
    });

    expect(result.task?.status).toBe("UNMATCHED");
    expect(result.task?.matchedDeviceId).toBeNull();
    expect(result.task?.matchNote).toBe("无绑定该抖音号的设备：禁用号");
  });

  test("matches a Douyin task by account ID when its account name is unavailable", async () => {
    const result = await claimAndMatchPublishTask(configId, "node11-test", {
      accountName: "测试号001",
      fetch: fetchTask({ ...baseTask, taskId: baseTask.taskId + "-douyin-id", accountName: "test-001" }),
      logger: () => undefined
    });

    expect(result.task?.status).toBe("MATCHED");
    expect(result.task?.matchedDeviceId).toBe(matchedDeviceId);
  });

  test("matches a WeChat Channels task by the same Douyin account name and requires channel capability", async () => {
    const result = await claimAndMatchPublishTask(configId, "node11-test", {
      accountName: "测试号001",
      fetch: fetchTask({
        ...baseTask,
        taskId: baseTask.taskId + "-channels-douyin-name",
        platform: "视频号",
        accountName: "测试号001"
      }),
      logger: () => undefined
    });

    expect(result.task?.status).toBe("MATCHED");
    expect(result.task?.matchedDeviceId).toBe(matchedDeviceId);
    expect(result.task?.matchedDeviceId).not.toBe(channelMatchedDeviceId);
  });

  test("matches a WeChat Channels task by the same Douyin account ID", async () => {
    const result = await claimAndMatchPublishTask(configId, "node11-test", {
      accountName: "测试号001",
      fetch: fetchTask({
        ...baseTask,
        taskId: baseTask.taskId + "-channels-douyin-id",
        platform: "视频号",
        accountName: "test-001"
      }),
      logger: () => undefined
    });

    expect(result.task?.status).toBe("MATCHED");
    expect(result.task?.matchedDeviceId).toBe(matchedDeviceId);
  });

  test("does not route a WeChat Channels task using only a matching channel name", async () => {
    const result = await claimAndMatchPublishTask(configId, "node11-test", {
      accountName: "测试号001",
      fetch: fetchTask({
        ...baseTask,
        taskId: baseTask.taskId + "-channels-name-only",
        platform: "视频号",
        accountName: "视频号测试01"
      }),
      logger: () => undefined
    });

    expect(result.task?.status).toBe("UNMATCHED");
    expect(result.task?.matchedDeviceId).toBeNull();
    expect(result.task?.matchNote).toBe("无绑定该抖音号的设备：视频号测试01");
  });

  test("stores unmatched when the matched device has no WeChat Channels binding", async () => {
    const result = await claimAndMatchPublishTask(configId, "node11-test", {
      accountName: "测试号001",
      fetch: fetchTask({
        ...baseTask,
        taskId: baseTask.taskId + "-channels-capability",
        platform: "视频号",
        accountName: "缺视频号能力"
      }),
      logger: () => undefined
    });

    expect(result.task?.status).toBe("UNMATCHED");
    expect(result.task?.matchedDeviceId).toBeNull();
    expect(result.task?.matchNote).toBe("未发布：该设备未绑定视频号");
    expect(channelUnsupportedDeviceId).not.toBe("");
  });

  test("stores unmatched when an external task omits the Douyin account", async () => {
    const result = await claimAndMatchPublishTask(configId, "node11-test", {
      accountName: "测试号001",
      fetch: fetchTask({ ...baseTask, taskId: baseTask.taskId + "-no-account", accountName: null }),
      logger: () => undefined
    });

    expect(result.task?.status).toBe("UNMATCHED");
    expect(result.task?.matchedDeviceId).toBeNull();
    expect(result.task?.matchNote).toBe("外部任务缺少抖音账号");
  });

  test("does not persist when the external API returns null", async () => {
    const result = await claimAndMatchPublishTask(configId, "node11-test", {
      accountName: "测试号001",
      fetch: fetchTask(null),
      logger: () => undefined
    });
    expect(result).toEqual({ claimed: false, created: false, task: null });
  });
});

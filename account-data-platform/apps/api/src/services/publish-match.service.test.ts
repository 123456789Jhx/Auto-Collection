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
const disabledDeviceCode = `node11-disabled-${suffix.slice(0, 12)}`;
let configId = "";
let matchedDeviceId = "";

const baseTask = {
  title: "节点11发布任务",
  description: "外部接口匹配测试",
  coverUrl: null,
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
      externalTokenEnv: tokenEnv
    },
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: "node11-test",
    updatedBy: "node11-test"
  }).returning();
  configId = config.id;

  const [matchedDevice] = await db.insert(collectorDevices).values({
    deviceCode: matchedDeviceCode,
    deviceName: "节点11命中设备",
    enabled: true,
    accountProfile: {
      douyinAccountId: "test-001",
      douyinAccountName: "测试号001",
      wechatChannelsName: ""
    },
    createdBy: "node11-test",
    updatedBy: "node11-test"
  }).returning();
  matchedDeviceId = matchedDevice.id;

  await db.insert(collectorDevices).values({
    deviceCode: disabledDeviceCode,
    deviceName: "节点11禁用设备",
    enabled: false,
    accountProfile: {
      douyinAccountId: "disabled-001",
      douyinAccountName: "禁用号",
      wechatChannelsName: ""
    },
    createdBy: "node11-test",
    updatedBy: "node11-test"
  });
});

afterAll(async () => {
  if (configId) {
    await db.delete(publishTasks).where(eq(publishTasks.configId, configId));
    await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, configId));
  }
  await db.delete(collectorDevices).where(inArray(collectorDevices.deviceCode, [matchedDeviceCode, disabledDeviceCode]));
  delete process.env[tokenEnv];
});

describe("publish task matching", () => {
  test("matches an enabled account and persists idempotently", async () => {
    const first = await claimAndMatchPublishTask(configId, "node11-test", {
      fetch: fetchTask(baseTask),
      logger: () => undefined
    });
    const repeated = await claimAndMatchPublishTask(configId, "node11-test", {
      fetch: fetchTask(baseTask),
      logger: () => undefined
    });

    expect(first.task?.status).toBe("MATCHED");
    expect(first.task?.matchedDeviceId).toBe(matchedDeviceId);
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
      fetch: fetchTask({ ...baseTask, taskId: `${baseTask.taskId}-unmatched`, accountName: "禁用号" }),
      logger: () => undefined
    });

    expect(result.task?.status).toBe("UNMATCHED");
    expect(result.task?.matchedDeviceId).toBeNull();
    expect(result.task?.matchNote).toBe("未命中：无绑定该账号设备");
  });

  test("does not persist when the external API returns null", async () => {
    const result = await claimAndMatchPublishTask(configId, "node11-test", {
      fetch: fetchTask(null),
      logger: () => undefined
    });
    expect(result).toEqual({ claimed: false, created: false, task: null });
  });
});

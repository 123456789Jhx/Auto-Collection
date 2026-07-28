import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import { eq, inArray } from "drizzle-orm";
import { db } from "../repositories/db";
import { reportPublishTaskResult } from "./publish-task-result.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
const tokenEnv = `NODE12_RESULT_TOKEN_${suffix}`;
const deviceCode = `node12-result-${suffix.slice(0, 10)}`;
let configId = "";
let deviceId = "";
const taskIds: string[] = [];

beforeAll(async () => {
  process.env[tokenEnv] = "node12-result-token";
  const [savedConfig] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: `节点12结果配置_${suffix}`,
    configPayload: {
      externalBaseUrl: "http://wecom.mock.local",
      externalTokenEnv: tokenEnv
    },
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: "node12-test",
    updatedBy: "node12-test"
  }).returning();
  configId = savedConfig.id;

  const [device] = await db.insert(collectorDevices).values({
    deviceCode,
    enabled: true,
    createdBy: "node12-test",
    updatedBy: "node12-test"
  }).returning();
  deviceId = device.id;

  const rows = await db.insert(publishTasks).values([
    {
      configId,
      taskId: `success-${suffix}`,
      platform: "DOUYIN",
      accountName: "节点12结果号",
      title: "成功任务",
      description: "#丰收",
      videoUrl: "https://media.example.test/success.mp4",
      status: "DISPATCHED",
      matchedDeviceId: deviceId
    },
    {
      configId,
      taskId: `topic-${suffix}`,
      platform: "DOUYIN",
      accountName: "节点12结果号",
      title: "待补话题任务",
      description: "缺话题",
      videoUrl: "https://media.example.test/topic.mp4",
      status: "DISPATCHED",
      matchedDeviceId: deviceId
    }
  ]).returning();
  taskIds.push(...rows.map((row) => row.id));
});

afterAll(async () => {
  await db.delete(publishTasks).where(inArray(publishTasks.id, taskIds));
  await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, configId));
  await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
  delete process.env[tokenEnv];
});

describe("publish task result mapping", () => {
  test("reports success to wecom and stores the published fields", async () => {
    const patches: unknown[] = [];
    const result = await reportPublishTaskResult(taskIds[0], {
      deviceId: deviceCode,
      status: "SUCCEEDED",
      publishedUrl: "https://douyin.example.test/video/1",
      platformContentId: "douyin-content-1"
    }, "node12-device", {
      fetch: async (_input, init) => {
        patches.push(JSON.parse(String(init?.body)));
        return Response.json({ success: true });
      },
      logger: () => undefined
    });

    expect(result.status).toBe("REPORTED");
    expect(result.publishedUrl).toBe("https://douyin.example.test/video/1");
    expect(result.platformContentId).toBe("douyin-content-1");
    expect(result.finishedAt).toBeInstanceOf(Date);
    expect(result.reportedAt).toBeInstanceOf(Date);
    expect(patches).toEqual([{
      platform: "抖音",
      status: "已发布",
      publishedUrl: "https://douyin.example.test/video/1",
      platformContentId: "douyin-content-1"
    }]);
  });

  test("keeps topic pending for manual completion without patching wecom", async () => {
    let patchCount = 0;
    const result = await reportPublishTaskResult(taskIds[1], {
      deviceId: deviceCode,
      status: "TOPIC_PENDING",
      error: "话题数量不足"
    }, "node12-device", {
      fetch: async () => {
        patchCount += 1;
        return Response.json({ success: true });
      },
      logger: () => undefined
    });

    expect(result.status).toBe("TOPIC_PENDING");
    expect(result.resultError).toBe("话题数量不足");
    expect(result.reportedAt).toBeNull();
    expect(patchCount).toBe(0);
  });
});

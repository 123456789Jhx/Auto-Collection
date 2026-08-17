import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, mobileCommands, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import { eq, inArray } from "drizzle-orm";
import { db } from "../repositories/db";
import { completePublishTaskTopics, reportPublishTaskResult, shouldQueueExternalPublishStatus } from "./publish-task-result.service";

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
      externalTokenEnv: tokenEnv,
      publishTimeSlots: [],
      responseDelayMsMin: 10,
      responseDelayMsMax: 20,
      actionWaitMsMin: 30,
      actionWaitMsMax: 40,
      expectedTopicCount: 5,
      downloadDir: "/sdcard/"
    },
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: "node12-test",
    updatedBy: "node12-test"
  }).returning();
  configId = savedConfig.id;

  const [device] = await db.insert(collectorDevices).values({
    deviceCode,
    enabled: true,
    status: "online",
    lastHeartbeatAt: new Date(),
    accountProfile: {
      douyinAccountName: "节点12结果号",
      wechatChannelsName: "节点12结果视频号"
    },
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
      coverUrl: "https://media.example.test/topic-cover.jpg",
      videoUrl: "https://media.example.test/topic.mp4",
      status: "DISPATCHED",
      matchedDeviceId: deviceId
    },
    {
      configId,
      taskId: `topic-invalid-${suffix}`,
      platform: "DOUYIN",
      accountName: "节点12结果号",
      title: "补全仍不合格任务",
      description: "缺话题",
      coverUrl: "https://media.example.test/topic-cover.jpg",
      videoUrl: "https://media.example.test/topic-invalid.mp4",
      status: "TOPIC_PENDING",
      matchNote: "应有5个#，实际0个"
    },
    {
      configId,
      taskId: `topic-resolve-${suffix}`,
      platform: "DOUYIN",
      accountName: "节点12结果号",
      title: "补全后首次匹配任务",
      description: "缺话题",
      coverUrl: "https://media.example.test/topic-cover.jpg",
      videoUrl: "https://media.example.test/topic-resolve.mp4",
      status: "TOPIC_PENDING",
      matchNote: "应有5个#，实际0个"
    }
  ]).returning();
  taskIds.push(...rows.map((row) => row.id));
});

afterAll(async () => {
  await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
  await db.delete(publishTasks).where(inArray(publishTasks.id, taskIds));
  await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, configId));
  await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
  delete process.env[tokenEnv];
});

describe("publish task result mapping", () => {
  test("delegates tasks with an interface run id after the mature phone action", async () => {
    const source = await Bun.file(new URL("./publish-task-result.service.ts", import.meta.url)).text();
    expect(source).toContain("interfaceRunId");
    expect(source).toContain("publishInterfaceResultService");
  });

  test("saves the result before enqueueing an EXTERNAL outbox record", async () => {
    const outboxInputs: unknown[] = [];
    const result = await reportPublishTaskResult(taskIds[0], {
      deviceId: deviceCode,
      status: "SUCCEEDED",
      publishedUrl: "https://douyin.example.test/video/1",
      platformContentId: "douyin-content-1"
    }, "node12-device", {
      enqueueExternalStatus: async (input) => { outboxInputs.push(input); }
    });

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      publishedUrl: "https://douyin.example.test/video/1",
      platformContentId: "douyin-content-1",
      reportedAt: null
    });
    expect(result).toHaveProperty("finishedAt");
    expect(outboxInputs).toEqual([taskIds[0]]);
  });

  test("only EXTERNAL terminal results queue an outbox record", () => {
    expect(shouldQueueExternalPublishStatus("EXTERNAL", "SUCCEEDED")).toBeTrue();
    expect(shouldQueueExternalPublishStatus("EXTERNAL", "FAILED")).toBeTrue();
    expect(shouldQueueExternalPublishStatus("NONE", "SUCCEEDED")).toBeFalse();
    expect(shouldQueueExternalPublishStatus("NONE", "FAILED")).toBeFalse();
    expect(shouldQueueExternalPublishStatus("EXTERNAL", "TOPIC_PENDING")).toBeFalse();
  });

  test("keeps the saved result when enqueueing external reporting fails", async () => {
    const failures: unknown[] = [];
    const result = await reportPublishTaskResult(taskIds[1], {
      deviceId: deviceCode,
      status: "FAILED",
      error: "素材下载失败"
    }, "node12-device", {
      enqueueExternalStatus: async () => { throw new Error("outbox unavailable"); },
      markExternalReportFailure: async (_taskId, error) => { failures.push(error); }
    });

    expect(result).toMatchObject({ status: "FAILED", resultError: "素材下载失败" });
    expect(failures).toHaveLength(1);
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

    expect(result).toMatchObject({
      status: "TOPIC_PENDING",
      resultError: "话题数量不足",
      reportedAt: null
    });
    expect(patchCount).toBe(0);
  });

  test("rejects an invalid topic completion without changing the pending task", async () => {
    await expect(completePublishTaskTopics(
      taskIds[2],
      "补全后仍只有 #一 #二 #三 #四",
      "node12-admin"
    )).rejects.toThrow("应有5个#，实际4个");

    const [task] = await db.select().from(publishTasks).where(eq(publishTasks.id, taskIds[2]));
    expect(task).toMatchObject({ status: "TOPIC_PENDING", matchedDeviceId: null });
  });

  test("matches and dispatches a pre-match topic pending task after valid completion", async () => {
    await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
    await db.update(publishTasks).set({ status: "FAILED", matchedDeviceId: null }).where(eq(publishTasks.id, taskIds[1]));
    const result = await completePublishTaskTopics(
      taskIds[3],
      "补全完成 #一 #二 #三 #四 #五",
      "node12-admin"
    );

    expect(result).toMatchObject({
      status: "DISPATCHED",
      matchedDeviceId: deviceId,
      description: "补全完成 #一 #二 #三 #四 #五"
    });
    const [command] = await db.select().from(mobileCommands).where(eq(
      mobileCommands.idempotencyKey,
      `${taskIds[3]}:${deviceId}`
    ));
    expect(command).toBeDefined();
    expect(command.payloadJson).toMatchObject({
      description: "补全完成 #一 #二 #三 #四 #五",
      expectedTopicCount: 5,
      topicResolveTimeoutMinutes: 30
    });
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { getPublishTaskDashboard } from "./publish-dispatch.repository";

const suffix = crypto.randomUUID().replaceAll("-", "");
const actor = "publish-dashboard-test";
let configId = "";
let deviceId = "";

async function seedTask(values: Record<string, unknown>) {
  const [task] = await db.insert(publishTasks).values({
    configId,
    taskId: "dashboard-" + crypto.randomUUID(),
    platform: "DOUYIN",
    accountName: "dashboard-account",
    title: "Dashboard task",
    description: "#one #two",
    coverUrl: "https://media.example.test/dashboard-cover.jpg",
    videoUrl: "https://media.example.test/dashboard.mp4",
    status: "MATCHED",
    createdBy: actor,
    updatedBy: actor,
    ...values
  }).returning();
  if (!task) throw new Error("PUBLISH_TASK_CREATE_FAILED");
  return task;
}

beforeAll(async () => {
  const [config] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: "publish-dashboard-" + suffix,
    configPayload: { expectedTopicCount: 2 },
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: actor,
    updatedBy: actor
  }).returning();
  if (!config) throw new Error("PUBLISH_CONFIG_CREATE_FAILED");
  configId = config.id;

  const [device] = await db.insert(collectorDevices).values({
    deviceCode: "publish-dashboard-" + suffix.slice(0, 12),
    enabled: true,
    status: "online",
    lastHeartbeatAt: new Date(),
    accountProfile: { douyinAccountName: "dashboard-account" },
    createdBy: actor,
    updatedBy: actor
  }).returning();
  if (!device) throw new Error("PUBLISH_DEVICE_CREATE_FAILED");
  deviceId = device.id;
});

afterEach(async () => {
  await db.delete(publishTasks).where(eq(publishTasks.configId, configId));
});

afterAll(async () => {
  await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, configId));
  await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
});

describe("publish task dashboard", () => {
  test("separates active busy work from terminal unpublished failures and returns retry fields", async () => {
    const now = new Date();
    const baseline = await getPublishTaskDashboard(now);
    const busy = await seedTask({
      status: "PUBLISH_BUSY",
      matchedDeviceId: deviceId,
      failureCode: "PUBLISH_BUSY",
      dispatchRetryCount: 2,
      nextDispatchAt: new Date(now.getTime() + 5 * 60_000),
      lastDispatchAttemptAt: now,
      resultError: "PUBLISH_BUSY"
    });
    await seedTask({ status: "TOPIC_PENDING", matchedDeviceId: deviceId });
    await seedTask({
      status: "REPORTED",
      matchedDeviceId: deviceId,
      failureCode: "COVER_REQUIRED",
      resultError: "COVER_REQUIRED",
      reportStatus: "REPORTED",
      reportedAt: now
    });
    await seedTask({ status: "CHANNELS_VERIFY_PENDING", platform: "WECHAT_CHANNELS", matchedDeviceId: deviceId });
    await seedTask({ status: "FAILED", matchedDeviceId: deviceId, reportStatus: "REPORT_FAILED", reportLastError: "UPSTREAM_ERROR" });
    await seedTask({
      status: "REPORTED",
      matchedDeviceId: deviceId,
      failureCode: "PUBLISH_BUSY",
      resultError: "PUBLISH_BUSY",
      reportStatus: "REPORTED",
      reportedAt: now
    });
    await seedTask({ status: "REPORTED", matchedDeviceId: deviceId, reportStatus: "REPORTED", reportedAt: now });
    await seedTask({ status: "REPORTED", matchedDeviceId: null, reportStatus: "REPORTED", reportedAt: now });

    const dashboard = await getPublishTaskDashboard(now);
    expect(dashboard.stats).toMatchObject({
      success: baseline.stats.success + 1,
      unpublished: baseline.stats.unpublished + 2,
      unmatched: baseline.stats.unmatched + 1,
      busy: baseline.stats.busy + 1,
      topicPending: baseline.stats.topicPending + 1,
      materialInvalid: baseline.stats.materialInvalid + 1,
      channelsVerifyPending: baseline.stats.channelsVerifyPending + 1,
      reportFailed: baseline.stats.reportFailed + 1
    });
    expect(dashboard.data.find((task) => task.id === busy.id)).toMatchObject({
      failureCode: "PUBLISH_BUSY",
      dispatchRetryCount: 2,
      nextDispatchAt: expect.any(Date),
      lastDispatchAttemptAt: expect.any(Date)
    });
  });
});

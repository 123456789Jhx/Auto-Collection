import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, mobileCommands, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import { eq } from "drizzle-orm";
import { db } from "../repositories/db";
import { dispatchPublishConfigNow } from "./publish-scheduler.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
const tokenEnv = `PUBLISH_MATERIAL_TOKEN_${suffix}`;
const actor = "publish-material-test";
let configId = "";
let deviceId = "";

function rawExternalTask(platform: "\u6296\u97f3" | "\u89c6\u9891\u53f7", overrides: Record<string, unknown> = {}) {
  return {
    taskId: `material-${platform}-${crypto.randomUUID()}`,
    accountName: "material-test-account",
    title: "Material validation task",
    description: "#topic",
    coverUrl: "https://media.example.test/cover.jpg",
    videoUrl: "https://media.example.test/video.mp4",
    platform,
    status: "\u5f85\u53d1\u5e03",
    ...overrides
  };
}

function fetchTasks(
  tasks: Partial<Record<"\u6296\u97f3" | "\u89c6\u9891\u53f7", Record<string, unknown>>>,
  patches: Record<string, unknown>[],
  patchStatus = 200
) {
  const delivered = new Set<string>();
  return async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      if (patchStatus >= 400) {
        return Response.json({ error: { code: "UPSTREAM_ERROR", message: "status patch failed" } }, { status: patchStatus });
      }
      return Response.json({ success: true });
    }
    const body = JSON.parse(String(init?.body || "{}")) as { platform?: "\u6296\u97f3" | "\u89c6\u9891\u53f7" };
    const platform = body.platform;
    if (!platform || delivered.has(platform)) return Response.json({ data: null });
    delivered.add(platform);
    return Response.json({ data: tasks[platform] ?? null });
  };
}

beforeAll(async () => {
  process.env[tokenEnv] = "publish-material-token";
  const [config] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: `publish-material-${suffix}`,
    configPayload: {
      externalBaseUrl: "http://wecom.mock.local",
      externalTokenEnv: tokenEnv,
      publishTimeSlots: [],
      platforms: ["\u6296\u97f3", "\u89c6\u9891\u53f7"],
      responseDelayMsMin: 10,
      responseDelayMsMax: 20,
      actionWaitMsMin: 30,
      actionWaitMsMax: 40,
      expectedTopicCount: 1
    },
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: actor,
    updatedBy: actor
  }).returning();
  if (!config) throw new Error("PUBLISH_CONFIG_CREATE_FAILED");
  configId = config.id;

  const [device] = await db.insert(collectorDevices).values({
    deviceCode: `publish-material-${suffix.slice(0, 12)}`,
    enabled: true,
    status: "online",
    lastHeartbeatAt: new Date(),
    accountProfile: {
      douyinAccountName: "material-test-account",
      wechatChannelsName: "material-test-channels"
    },
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

describe("publish material validation", () => {
  test("reports both platform tasks when their shared material has no cover", async () => {
    const patches: Record<string, unknown>[] = [];
    const result = await dispatchPublishConfigNow(configId, actor, {
      accountName: "publish-material-account",
      fetch: fetchTasks({
        "\u6296\u97f3": rawExternalTask("\u6296\u97f3", { coverUrl: null }),
        "\u89c6\u9891\u53f7": rawExternalTask("\u89c6\u9891\u53f7", { coverUrl: null })
      }, patches),
      logger: () => undefined
    });

    expect(result).toMatchObject({ dispatched: 0, busy: 0 });
    expect(patches).toEqual([
      expect.objectContaining({ platform: "\u6296\u97f3", status: "\u672a\u53d1\u5e03", error: "COVER_REQUIRED" }),
      expect.objectContaining({ platform: "\u89c6\u9891\u53f7", status: "\u672a\u53d1\u5e03", error: "COVER_REQUIRED" })
    ]);
    const tasks = await db.select().from(publishTasks).where(eq(publishTasks.configId, configId));
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.status === "REPORTED" && task.failureCode === "COVER_REQUIRED" && task.reportStatus === "REPORTED" && task.reportedAt instanceof Date)).toBeTrue();
    expect(tasks.every((task) => task.matchedDeviceId === null)).toBeTrue();
    const commands = await db.select().from(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
    expect(commands).toHaveLength(0);
  });

  test("reports an invalid video URL before device matching or command creation", async () => {
    await db.update(remoteScriptConfigs).set({
      configPayload: {
        externalBaseUrl: "http://wecom.mock.local",
        externalTokenEnv: tokenEnv,
        publishTimeSlots: [],
        platforms: ["\u6296\u97f3"],
        responseDelayMsMin: 10,
        responseDelayMsMax: 20,
        actionWaitMsMin: 30,
        actionWaitMsMax: 40,
        expectedTopicCount: 1
      }
    }).where(eq(remoteScriptConfigs.id, configId));
    const patches: Record<string, unknown>[] = [];
    const result = await dispatchPublishConfigNow(configId, actor, {
      accountName: "publish-material-account",
      fetch: fetchTasks({
        "\u6296\u97f3": rawExternalTask("\u6296\u97f3", { videoUrl: "ftp://media.example.test/video.mp4" })
      }, patches),
      logger: () => undefined
    });

    expect(result).toMatchObject({ dispatched: 0, busy: 0 });
    expect(patches).toEqual([expect.objectContaining({ error: "VIDEO_URL_INVALID" })]);
    const [task] = await db.select().from(publishTasks).where(eq(publishTasks.configId, configId));
    expect(task).toMatchObject({ status: "REPORTED", failureCode: "VIDEO_URL_INVALID", reportStatus: "REPORTED", matchedDeviceId: null });
    const commands = await db.select().from(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
    expect(commands).toHaveLength(0);
  });
  test("marks an external status PATCH failure as report failed", async () => {
    const patches: Record<string, unknown>[] = [];
    await expect(dispatchPublishConfigNow(configId, actor, {
      accountName: "publish-material-account",
      fetch: fetchTasks({ "抖音": rawExternalTask("抖音", { coverUrl: null }) }, patches, 500),
      logger: () => undefined
    })).rejects.toThrow("UPSTREAM_ERROR");

    const [task] = await db.select().from(publishTasks).where(eq(publishTasks.configId, configId));
    expect(task).toMatchObject({
      status: "FAILED",
      failureCode: "COVER_REQUIRED",
      resultError: "COVER_REQUIRED",
      reportStatus: "REPORT_FAILED",
      reportLastError: "UPSTREAM_ERROR",
      reportedAt: null
    });
    expect(patches).toHaveLength(1);
  });
});

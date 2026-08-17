import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, mobileCommands, publishTasks, remoteScriptConfigs } from "@pkg/db/schema";
import type { ExternalPublishPlatform, WecomPublishTask } from "@pkg/types";
import { eq } from "drizzle-orm";
import { db } from "../repositories/db";
import type { PublishVideoConfig } from "./publish-config";
import { dispatchPublishConfigNow } from "./publish-scheduler.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
const tokenEnv = `PUBLISH_PLATFORM_TOKEN_${suffix}`;
const actor = "publish-platform-test";
let configId = "";
let deviceId = "";

type PlatformScenario = {
  name: string;
  enabled: ExternalPublishPlatform[];
  externalPlatform: ExternalPublishPlatform;
  commandPlatform: "DOUYIN" | "WECHAT_CHANNELS";
};

const scenarios: PlatformScenario[] = [
  {
    name: "Douyin",
    enabled: ["\u6296\u97f3"],
    externalPlatform: "\u6296\u97f3",
    commandPlatform: "DOUYIN"
  },
  {
    name: "WeChat Channels",
    enabled: ["\u89c6\u9891\u53f7"],
    externalPlatform: "\u89c6\u9891\u53f7",
    commandPlatform: "WECHAT_CHANNELS"
  }
];

function publishConfig(platforms: ExternalPublishPlatform[]): PublishVideoConfig {
  return {
    sourceMode: "external_pull",
    externalBaseUrl: "http://wecom.mock.local",
    externalTokenEnv: tokenEnv,
    publishTimeSlots: [],
    platforms,
    responseDelayMsMin: 10,
    responseDelayMsMax: 20,
    actionWaitMsMin: 30,
    actionWaitMsMax: 40,
    expectedTopicCount: 2,
    requireCover: false,
    topicResolveTimeoutMinutes: 30,
    isDefault: false,
    downloadDir: "/sdcard/publish-video"
  };
}

function externalTask(platform: ExternalPublishPlatform): WecomPublishTask {
  return {
    taskId: `platform-${platform}-${crypto.randomUUID()}`,
    accountName: "platform-test-account",
    title: "Platform task",
    description: "#one #two",
    coverUrl: "https://media.example.test/platform-cover.jpg",
    videoUrl: "https://media.example.test/platform.mp4",
    platform,
    status: "\u5f85\u53d1\u5e03"
  };
}

function mockFetch(task: WecomPublishTask, claimedPlatforms: ExternalPublishPlatform[]) {
  let returnedTask = false;
  return async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}")) as { platform?: ExternalPublishPlatform };
    if (body.platform) claimedPlatforms.push(body.platform);
    if (!returnedTask && body.platform === task.platform) {
      returnedTask = true;
      return Response.json({ data: task });
    }
    return Response.json({ data: null });
  };
}

beforeAll(async () => {
  process.env[tokenEnv] = "publish-platform-token";
  const [config] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: `publish-platform-${suffix}`,
    configPayload: publishConfig(["\u6296\u97f3", "\u89c6\u9891\u53f7"]),
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: actor,
    updatedBy: actor
  }).returning();
  if (!config) throw new Error("PUBLISH_CONFIG_CREATE_FAILED");
  configId = config.id;

  const [device] = await db.insert(collectorDevices).values({
    deviceCode: `publish-platform-${suffix.slice(0, 12)}`,
    enabled: true,
    status: "online",
    lastHeartbeatAt: new Date(),
    accountProfile: {
      douyinAccountName: "platform-test-account",
      wechatChannelsName: "platform-test-channels"
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

describe("publish platform enablement", () => {
  for (const scenario of scenarios) {
    test(`claims and dispatches only ${scenario.name} when it is the sole enabled platform`, async () => {
      await db.update(remoteScriptConfigs).set({
        configPayload: publishConfig(scenario.enabled)
      }).where(eq(remoteScriptConfigs.id, configId));
      const claimedPlatforms: ExternalPublishPlatform[] = [];

      const result = await dispatchPublishConfigNow(configId, actor, {
        accountName: "publish-platform-account",
        fetch: mockFetch(externalTask(scenario.externalPlatform), claimedPlatforms),
        logger: () => undefined
      });

      expect(result).toMatchObject({ claimedCount: 1, dispatched: 1, busy: 0 });
      expect([...new Set(claimedPlatforms)]).toEqual([scenario.externalPlatform]);
      const tasks = await db.select().from(publishTasks).where(eq(publishTasks.configId, configId));
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ platform: scenario.commandPlatform });
      const commands = await db.select().from(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
      expect(commands).toHaveLength(1);
      expect(commands[0].payloadJson).toMatchObject({ platform: scenario.commandPlatform });
    });
  }
});

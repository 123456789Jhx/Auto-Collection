import { describe, expect, test } from "bun:test";
import { isPublishTimeWithinWindows } from "./publish-config";
import {
  runPublishDeviceSchedulerTick,
  type PublishDeviceSchedulerDependencies
} from "./publish-device-scheduler.service";

const externalConfig = {
  id: "config-1",
  status: "ENABLED",
  configPayload: {
    sourceMode: "external_pull",
    externalBaseUrl: "https://external.example.test",
    externalTokenEnv: "PUBLISH_SCHEDULER_TEST_TOKEN",
    publishTimeSlots: [],
    platforms: ["\u6296\u97f3", "\u89c6\u9891\u53f7"],
    responseDelayMsMin: 1_000,
    responseDelayMsMax: 1_000,
    actionWaitMsMin: 1_000,
    actionWaitMsMax: 1_000,
    expectedTopicCount: 5,
    requireCover: true,
    topicResolveTimeoutMinutes: 30,
    isDefault: false
  }
};

const schedule = {
  id: "schedule-1",
  configId: "config-1",
  deviceCode: "device-1",
  platforms: ["DOUYIN"],
  timeWindows: [{ start: "09:00", end: "10:00" }],
  enabled: true
};

function rawTask(taskId: string, platform = "\u6296\u97f3", videoUrl = "https://cdn.example.test/videos/video.mp4") {
  return {
    taskId,
    accountName: "Account A",
    platform,
    title: "A title",
    description: "A description #topic",
    videoUrl,
    coverUrl: "https://cdn.example.test/covers/cover.jpg"
  };
}

function createDependencies(input: {
  schedules?: Array<Record<string, unknown>>;
  busy?: boolean;
  bindings?: Record<string, Array<{ accountName: string }>>;
  claims?: Array<unknown | null>;
  invalid?: boolean;
  activeQuarantine?: boolean;
}) {
  const claims = [...(input.claims ?? [])];
  const claimPayloads: Array<Record<string, unknown>> = [];
  const saved: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  const commands: string[] = [];
  const materialInvalid: string[] = [];
  const claimQuarantines: Array<Record<string, unknown>> = [];
  const dependencies = {
    listSchedules: async () => (input.schedules ?? [schedule]) as never,
    findOnlineDevice: async () => ({ id: "device-db-id" }) as never,
    hasActivePublish: async () => Boolean(input.busy || commands.length),
    getConfig: async () => externalConfig as never,
    listBindings: async (_deviceCode: string, platform: string) => {
      const fallback = platform === "DOUYIN" ? [{ accountName: "Account A" }] : [{ accountName: "Account B" }];
      return (input.bindings?.[platform] ?? fallback) as never;
    },
    findClaimQuarantine: async () => input.activeQuarantine ? { blockedUntil: new Date("2026-08-01T10:00:00") } as never : null,
    saveClaimQuarantine: async (payload: Record<string, unknown>) => {
      claimQuarantines.push(payload);
      return payload as never;
    },
    claimTask: async (_config: unknown, payload: Record<string, unknown>) => {
      claimPayloads.push(payload);
      return claims.shift() ?? null;
    },
    normalizeMaterial: (material: { videoUrl: string; coverUrl: string | null }) => {
      if (input.invalid) return { valid: false as const, code: "MATERIAL_INVALID" as const };
      const preview = /^https:\/\/[^/]+\/public\/downloads\/([0-9a-f-]{36})\.mp4$/i.exec(material.videoUrl);
      if (preview) return {
        valid: true as const,
        videoUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/" + preview[1] + ".mp4",
        coverUrl: material.coverUrl || "https://media-auto.oss-cn-wuhan-lr.aliyuncs.com/covers/" + preview[1] + ".jpg"
      };
      return { valid: true as const, videoUrl: material.videoUrl, coverUrl: material.coverUrl || "https://cdn.example.test/cover.jpg" };
    },
    saveClaimedTask: async (payload: Record<string, unknown>) => {
      saved.push(payload);
      return { created: true, task: { id: "local-" + String(payload.taskId), failureCode: null } } as never;
    },
    createCommand: async (task: { id: string }) => {
      commands.push(task.id);
      return {} as never;
    },
    markDispatched: async () => ({}) as never,
    patchStatus: async (_config: unknown, taskId: string, payload: Record<string, unknown>) => {
      patches.push({ taskId, ...payload });
      return {} as never;
    },
    saveMaterialInvalid: async (taskId: string) => {
      materialInvalid.push(taskId);
      return {} as never;
    },
    enqueueStatusOutbox: async () => ({}) as never
  } as unknown as PublishDeviceSchedulerDependencies;
  return { dependencies, claimPayloads, saved, patches, commands, materialInvalid, claimQuarantines };
}

describe("publish device scheduler", () => {
  test("uses local [start, end) time windows including cross-midnight windows", () => {
    expect(isPublishTimeWithinWindows(new Date(2026, 7, 1, 9, 0), [{ start: "09:00", end: "10:00" }])).toBe(true);
    expect(isPublishTimeWithinWindows(new Date(2026, 7, 1, 10, 0), [{ start: "09:00", end: "10:00" }])).toBe(false);
    expect(isPublishTimeWithinWindows(new Date(2026, 7, 1, 0, 30), [{ start: "23:00", end: "01:00" }])).toBe(true);
    expect(isPublishTimeWithinWindows(new Date(2026, 7, 1, 1, 0), [{ start: "23:00", end: "01:00" }])).toBe(false);
  });

  test("does not claim outside the plan window, while busy, or during a cooldown", async () => {
    const outside = createDependencies({ claims: [rawTask("outside")] });
    const outsideResult = await runPublishDeviceSchedulerTick(new Date(2026, 7, 1, 8, 59), {}, outside.dependencies);
    expect(outside.claimPayloads).toEqual([]);
    expect(outsideResult.outcomes[0]).toMatchObject({ outcome: "OUTSIDE_TIME_WINDOW" });

    const busy = createDependencies({ busy: true, claims: [rawTask("busy")] });
    const busyResult = await runPublishDeviceSchedulerTick(new Date(2026, 7, 1, 9, 0), {}, busy.dependencies);
    expect(busy.claimPayloads).toEqual([]);
    expect(busyResult.outcomes[0]).toMatchObject({ outcome: "DEVICE_BUSY" });

    const cooldown = createDependencies({ activeQuarantine: true, claims: [rawTask("cooldown")] });
    const cooldownResult = await runPublishDeviceSchedulerTick(new Date(2026, 7, 1, 9, 5), {}, cooldown.dependencies);
    expect(cooldown.claimPayloads).toEqual([]);
    expect(cooldownResult.outcomes).toContainEqual(expect.objectContaining({ outcome: "CLAIM_QUARANTINED" }));
  });

  test("claims one Douyin task and converts preview material before creating the local task", async () => {
    const id = "6f6e9c23-bb63-4e5c-84b0-4d3c887e40c4";
    const state = createDependencies({ claims: [rawTask("task-preview", "\u6296\u97f3", "https://admin.example.test/public/downloads/" + id + ".mp4")] });
    const result = await runPublishDeviceSchedulerTick(new Date(2026, 7, 1, 9, 5), {}, state.dependencies);
    expect(state.claimPayloads).toEqual([{ platform: "\u6296\u97f3", accountName: "Account A" }]);
    expect(state.saved[0]).toMatchObject({ platform: "DOUYIN", videoUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/" + id + ".mp4" });
    expect(state.commands).toEqual(["local-task-preview"]);
    expect(result.outcomes).toContainEqual(expect.objectContaining({ outcome: "DISPATCHED", taskId: "task-preview" }));
  });

  test("uses the platform order and stops after dispatching the first task for a device", async () => {
    const bothPlatforms = { ...schedule, platforms: ["DOUYIN", "WECHAT_CHANNELS"] };
    const state = createDependencies({ schedules: [bothPlatforms], claims: [rawTask("douyin-first"), rawTask("channels-second", "\u89c6\u9891\u53f7")] });
    await runPublishDeviceSchedulerTick(new Date(2026, 7, 1, 9, 5), {}, state.dependencies);
    expect(state.claimPayloads).toEqual([{ platform: "\u6296\u97f3", accountName: "Account A" }]);
    expect(state.commands).toEqual(["local-douyin-first"]);
  });

  test("claims one WeChat Channels task with the mapped external platform", async () => {
    const channelsPlan = { ...schedule, platforms: ["WECHAT_CHANNELS"] };
    const channelsTask = { ...rawTask("channels-task", "\u89c6\u9891\u53f7"), accountName: "Account B" };
    const state = createDependencies({ schedules: [channelsPlan], claims: [channelsTask] });
    await runPublishDeviceSchedulerTick(new Date(2026, 7, 1, 9, 5), {}, state.dependencies);
    expect(state.claimPayloads).toEqual([{ platform: "\u89c6\u9891\u53f7", accountName: "Account B" }]);
    expect(state.saved[0]).toMatchObject({ platform: "WECHAT_CHANNELS", accountName: "Account B" });
    expect(state.commands).toEqual(["local-channels-task"]);
  });

  test("does not claim when a required binding is missing", async () => {
    const state = createDependencies({ bindings: { DOUYIN: [] }, claims: [rawTask("no-binding")] });
    const result = await runPublishDeviceSchedulerTick(new Date(2026, 7, 1, 9, 5), {}, state.dependencies);
    expect(state.claimPayloads).toEqual([]);
    expect(result.outcomes).toContainEqual(expect.objectContaining({ outcome: "BINDING_MISSING" }));
  });

  test("releases bad material once and persists a 30-minute lane cooldown", async () => {
    const state = createDependencies({ invalid: true, claims: [rawTask("bad-task")] });
    const now = new Date(2026, 7, 1, 9, 5);
    const result = await runPublishDeviceSchedulerTick(now, {}, state.dependencies);
    expect(state.patches).toEqual([{ taskId: "bad-task", platform: "\u6296\u97f3", status: "\u672a\u53d1\u5e03", error: "MATERIAL_INVALID" }]);
    expect(state.materialInvalid).toEqual(["local-bad-task"]);
    expect(state.claimQuarantines[0]).toMatchObject({ deviceCode: "device-1", platform: "DOUYIN", accountName: "Account A", reason: "MATERIAL_INVALID", lastExternalTaskId: "bad-task" });
    expect((state.claimQuarantines[0].blockedUntil as Date).getTime()).toBe(now.getTime() + 30 * 60_000);
    expect(result.outcomes).toContainEqual(expect.objectContaining({ outcome: "MATERIAL_INVALID" }));
  });
});

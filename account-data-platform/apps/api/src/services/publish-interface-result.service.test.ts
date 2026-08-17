import { describe, expect, test } from "bun:test";
import {
  createPublishInterfaceResultService,
  resolvePublishedSlotCredit,
  type PublishInterfaceResultContext,
  type PublishInterfaceResultRepository
} from "./publish-interface-result.service";

const now = new Date("2026-08-06T01:30:00.000Z");

function context(overrides: Partial<PublishInterfaceResultContext> = {}): PublishInterfaceResultContext {
  return {
    publishTaskId: "task-1",
    runId: "run-1",
    slotExecutionId: "slot-1",
    bindingId: "binding-1",
    deviceCode: "device-01",
    businessDate: "2026-08-06",
    slot: "MORNING",
    localResultStatus: null,
    taskStatus: "DISPATCHED",
    dispatchRetryCount: 0,
    dispatchedAt: new Date("2026-08-06T01:20:00.000Z"),
    commandFetchedAt: new Date("2026-08-06T01:20:00.000Z"),
    ...overrides
  };
}

function memoryRepository(initial = context()) {
  let current = initial;
  const events: Array<{ kind: string; [key: string]: unknown }> = [];
  const repository: PublishInterfaceResultRepository = {
    findContext: async () => current,
    savePublished: async (input) => {
      events.push({ kind: "PUBLISHED", ...input });
      current = { ...current, localResultStatus: "PUBLISHED" };
      return { localResultStatus: "PUBLISHED", idempotent: false };
    },
    scheduleRetry: async (input) => {
      events.push({ kind: "RETRY", ...input });
      current = { ...current, dispatchRetryCount: input.retryCount };
      return { localResultStatus: "FAILED", retryPending: true };
    },
    saveFinalFailure: async (input) => {
      events.push({ kind: "FAILED", ...input });
      current = { ...current, localResultStatus: "FAILED" };
      return { localResultStatus: "FAILED", retryPending: false };
    },
    saveResultUnknown: async (input) => {
      events.push({ kind: "RESULT_UNKNOWN", ...input });
      current = { ...current, localResultStatus: "RESULT_UNKNOWN" };
      return { localResultStatus: "RESULT_UNKNOWN", alertId: "alert-1" };
    },
    resolveResultUnknown: async (input) => {
      events.push({ kind: "RESOLVED", ...input });
      current = { ...current, localResultStatus: input.resolution };
      return { localResultStatus: input.resolution };
    }
  };
  return { repository, events, current: () => current };
}

describe("interface publish phone result", () => {
  test("credits a cross-midnight success to the actual next-day morning slot", () => {
    expect(resolvePublishedSlotCredit(context(), new Date("2026-08-06T16:30:00.000Z"))).toEqual({
      crossedBusinessDate: true,
      businessDate: "2026-08-07",
      slot: "MORNING"
    });
  });

  test("persists success, credits the slot and creates one outbox intent idempotently", async () => {
    const memory = memoryRepository();
    const service = createPublishInterfaceResultService({
      repository: memory.repository,
      now: () => now
    });
    const input = {
      deviceId: "device-01",
      status: "SUCCEEDED" as const,
      publishedUrl: "https://douyin.example.test/video/1"
    };

    expect(await service.report("task-1", input, "mobile:device-01")).toMatchObject({
      localResultStatus: "PUBLISHED"
    });
    expect(await service.report("task-1", input, "mobile:device-01")).toMatchObject({
      localResultStatus: "PUBLISHED",
      idempotent: true
    });
    expect(memory.events.filter((event) => event.kind === "PUBLISHED")).toHaveLength(1);
  });

  test("schedules retryable technical failures on the same task up to three retries", async () => {
    const memory = memoryRepository(context({ dispatchRetryCount: 2 }));
    const service = createPublishInterfaceResultService({
      repository: memory.repository,
      now: () => now
    });

    expect(await service.report("task-1", {
      deviceId: "device-01",
      status: "FAILED",
      error: "NETWORK_TIMEOUT"
    }, "mobile:device-01")).toMatchObject({ retryPending: true, retryCount: 3 });
    expect(memory.events.at(-1)).toMatchObject({
      kind: "RETRY",
      nextRetryAt: new Date("2026-08-06T01:40:00.000Z")
    });

    expect(await service.report("task-1", {
      deviceId: "device-01",
      status: "FAILED",
      error: "NETWORK_TIMEOUT"
    }, "mobile:device-01")).toMatchObject({ retryPending: false });
    expect(memory.events.at(-1)?.kind).toBe("FAILED");
  });

  test("does not retry material errors or unknown results", async () => {
    const memory = memoryRepository();
    const service = createPublishInterfaceResultService({
      repository: memory.repository,
      now: () => now
    });

    expect(await service.report("task-1", {
      deviceId: "device-01",
      status: "MATERIAL_INVALID",
      error: "VIDEO_URL_INVALID"
    }, "mobile:device-01")).toMatchObject({ retryPending: false });
    expect(memory.events.at(-1)?.kind).toBe("FAILED");

    const unknownMemory = memoryRepository();
    const unknownService = createPublishInterfaceResultService({
      repository: unknownMemory.repository,
      now: () => now
    });
    expect(await unknownService.report("task-1", {
      deviceId: "device-01",
      status: "RESULT_UNKNOWN",
      error: "发布按钮点击后页面无明确结果"
    }, "mobile:device-01")).toMatchObject({
      localResultStatus: "RESULT_UNKNOWN",
      alertId: "alert-1"
    });
    expect(unknownMemory.events.map((event) => event.kind)).toEqual(["RESULT_UNKNOWN"]);
  });

  test("rejects a result from a device outside the immutable binding snapshot", async () => {
    const memory = memoryRepository();
    const service = createPublishInterfaceResultService({ repository: memory.repository });
    await expect(service.report("task-1", {
      deviceId: "other-device",
      status: "PUBLISHED"
    }, "mobile:other-device")).rejects.toThrow("PUBLISH_TASK_DEVICE_MISMATCH");
    expect(memory.events).toHaveLength(0);
  });

  test("turns a fifteen-minute missing terminal result into result unknown", async () => {
    const memory = memoryRepository(context({
      commandFetchedAt: new Date("2026-08-06T01:15:00.000Z")
    }));
    const service = createPublishInterfaceResultService({
      repository: memory.repository,
      now: () => now
    });
    expect(await service.markTimedOut("task-1", "watchdog")).toMatchObject({
      localResultStatus: "RESULT_UNKNOWN"
    });
    expect(memory.events.at(-1)).toMatchObject({ kind: "RESULT_UNKNOWN", reason: "PHONE_RESULT_TIMEOUT" });
  });

  test("does not start the timeout clock before the phone fetches the command", async () => {
    const memory = memoryRepository(context({
      dispatchedAt: new Date("2026-08-06T01:00:00.000Z"),
      commandFetchedAt: new Date("2026-08-06T01:20:00.000Z")
    }));
    const service = createPublishInterfaceResultService({ repository: memory.repository, now: () => now });
    expect(await service.markTimedOut("task-1", "watchdog")).toEqual({ timedOut: false });
    expect(memory.events).toHaveLength(0);
  });
});

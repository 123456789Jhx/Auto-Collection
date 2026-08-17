import { describe, expect, test } from "bun:test";
import {
  classifyInterfaceRecoverySchedule,
  createPublishInterfaceRecoveryService
} from "./publish-interface-recovery.service";

const config = {
  configId: "11111111-1111-4111-8111-111111111111",
  morningPublishTime: "09:00",
  afternoonPublishTime: "15:00",
  maxConcurrentPublishing: 3,
  noMaterialRetryMinutes: 10,
  timezone: "Asia/Shanghai",
  platform: "DOUYIN"
} as const;

describe("interface publish restart recovery", () => {
  test("triggers a missed concrete publish time inside the window and expires it after the window", () => {
    expect(classifyInterfaceRecoverySchedule(config, new Date("2026-08-06T02:00:00.000Z")))
      .toEqual({ businessDate: "2026-08-06", triggerSlots: ["MORNING"], expireSlots: [] });
    expect(classifyInterfaceRecoverySchedule(config, new Date("2026-08-06T04:30:00.000Z")))
      .toEqual({ businessDate: "2026-08-06", triggerSlots: [], expireSlots: ["MORNING"] });
  });

  test("recovers scheduled, running and stopping runs but never a stopped run", async () => {
    const events: string[] = [];
    const runs = [
      { id: "scheduled", status: "SCHEDULED" as const, config },
      { id: "running", status: "RUNNING" as const, config },
      { id: "stopping", status: "STOPPING" as const, config },
      { id: "stopped", status: "STOPPED" as const, config }
    ];
    const service = createPublishInterfaceRecoveryService({
      now: () => new Date("2026-08-06T02:00:00.000Z"),
      listRuns: async () => runs,
      recoverReservations: async (runId) => { events.push(`reserve:${runId}`); },
      recoverSchedule: async (runId) => { events.push(`schedule:${runId}`); },
      triggerTick: async (runId) => { events.push(`tick:${runId}`); },
      reconcileStop: async (runId) => { events.push(`stop:${runId}`); },
      startOutbox: () => { events.push("outbox"); }
    });

    expect(await service.recover("recovery-worker")).toMatchObject({ recoveredRuns: 3 });
    expect(events).toEqual([
      "outbox",
      "reserve:scheduled", "schedule:scheduled", "tick:scheduled",
      "reserve:running", "schedule:running", "tick:running",
      "stop:stopping"
    ]);
    expect(events.some((event) => event.includes("stopped"))).toBe(false);
  });

  test("does not own a path that resends an existing phone command", async () => {
    const source = await Bun.file(new URL("./publish-interface-recovery.service.ts", import.meta.url)).text();
    expect(source).not.toContain("createPublishVideoTaskCommand");
    expect(source).not.toContain("redispatchPublishVideoTaskCommand");
  });
});

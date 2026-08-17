import { describe, expect, test } from "bun:test";
import { createPublishInterfaceWorker } from "./publish-interface-worker";

const config = {
  configId: "11111111-1111-4111-8111-111111111111",
  morningPublishTime: "09:00" as const,
  afternoonPublishTime: "15:00" as const,
  maxConcurrentPublishing: 3,
  noMaterialRetryMinutes: 10,
  timezone: "Asia/Shanghai" as const,
  platform: "DOUYIN" as const
};

function run(status: "SCHEDULED" | "RUNNING" | "STOPPING") {
  return { id: "run-1", status, ...config };
}

describe("interface publish worker", () => {
  test("exposes a dedicated worker factory", async () => {
    const source = await Bun.file(
      new URL("./publish-interface-worker.ts", import.meta.url)
    ).text().catch(() => "");

    expect(source).toContain("createPublishInterfaceWorker");
  });

  test("skips a concurrent tick while the current tick is still running", async () => {
    let releaseScheduler!: () => void;
    let enteredScheduler!: () => void;
    const entered = new Promise<void>((resolve) => { enteredScheduler = resolve; });
    const release = new Promise<void>((resolve) => { releaseScheduler = resolve; });
    let schedulerCalls = 0;
    const worker = createPublishInterfaceWorker({
      recoverActiveRuns: async () => undefined,
      getCurrentRun: async () => run("RUNNING"),
      markRunning: async () => run("RUNNING"),
      runSchedulerTick: async () => {
        schedulerCalls += 1;
        enteredScheduler();
        await release;
        return { dispatched: 0 };
      }
    });

    const first = worker.tick(new Date("2026-08-06T01:00:00.000Z"));
    await Promise.race([entered, Bun.sleep(50)]);
    expect(schedulerCalls).toBe(1);
    expect(await worker.tick()).toEqual({ outcome: "SKIPPED_REENTRANT" });
    releaseScheduler();
    expect(await first).toMatchObject({ outcome: "PROCESSED", runId: "run-1" });
    expect(schedulerCalls).toBe(1);
  });

  test("reconciles a stopping run without entering the scheduler", async () => {
    const events: string[] = [];
    const worker = createPublishInterfaceWorker({
      recoverActiveRuns: async () => { events.push("recover"); },
      getCurrentRun: async () => {
        events.push("current");
        return run("STOPPING");
      },
      markRunning: async () => {
        throw new Error("must not mark STOPPING as RUNNING");
      },
      runSchedulerTick: async () => {
        events.push("scheduler");
        throw new Error("must not claim while stopping");
      }
    });

    expect(await worker.tick()).toEqual({ outcome: "STOPPING", runId: "run-1" });
    expect(events).toEqual(["recover", "current"]);
  });

  test("recovers, marks a scheduled run active and then executes one central tick", async () => {
    const events: string[] = [];
    const worker = createPublishInterfaceWorker({
      recoverActiveRuns: async () => { events.push("recover"); },
      getCurrentRun: async () => {
        events.push("current");
        return run("SCHEDULED");
      },
      markRunning: async () => {
        events.push("running");
        return run("RUNNING");
      },
      runSchedulerTick: async (activeRun) => {
        events.push(`scheduler:${activeRun.status}`);
        return { dispatched: 2 };
      }
    });

    expect(await worker.tick()).toEqual({
      outcome: "PROCESSED",
      runId: "run-1",
      scheduler: { dispatched: 2 }
    });
    expect(events).toEqual(["recover", "current", "running", "scheduler:RUNNING"]);
  });

  test("uses the recovery and central scheduler services without consuming outbox", async () => {
    const source = await Bun.file(
      new URL("./publish-interface-worker.ts", import.meta.url)
    ).text();

    expect(source).toContain("publishInterfaceRecoveryService");
    expect(source).toContain("createPublishInterfaceSchedulerCore");
    expect(source).not.toContain("runPublishStatusOutboxTick");
  });

  test("never reclaims a slot that already owns a local publish task", async () => {
    const source = await Bun.file(
      new URL("./publish-interface-worker.ts", import.meta.url)
    ).text();

    expect(source).toContain("isNull(publishSlotExecutions.publishTaskId)");
  });
});

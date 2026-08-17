import { describe, expect, test } from "bun:test";
import {
  assertInterfacePublishRunAcceptsWork,
  createPublishInterfaceStopService,
  type PublishInterfaceStopTask
} from "./publish-interface-stop.service";

const now = new Date("2026-08-06T01:30:00.000Z");

function task(overrides: Partial<PublishInterfaceStopTask> = {}): PublishInterfaceStopTask {
  return {
    publishTaskId: "task-1",
    commandFetchedAt: null,
    sideEffectStartedAt: null,
    localResultStatus: null,
    reportStatus: "REPORT_PENDING",
    ...overrides
  };
}

describe("interface publish safe stop", () => {
  test("rejects scheduler and claim work immediately after entering stopping", () => {
    expect(() => assertInterfacePublishRunAcceptsWork("RUNNING")).not.toThrow();
    expect(() => assertInterfacePublishRunAcceptsWork("SCHEDULED")).not.toThrow();
    expect(() => assertInterfacePublishRunAcceptsWork("STOPPING"))
      .toThrow("INTERFACE_PUBLISH_RUN_NOT_ACCEPTING_WORK");
    expect(() => assertInterfacePublishRunAcceptsWork("STOPPED"))
      .toThrow("INTERFACE_PUBLISH_RUN_NOT_ACCEPTING_WORK");
  });

  test("releases only tasks whose phone command has not been fetched", async () => {
    const events: string[] = [];
    const service = createPublishInterfaceStopService({
      now: () => now,
      getRunStatus: async () => "STOPPING",
      listInFlight: async () => [
        task({ publishTaskId: "before-fetch" }),
        task({ publishTaskId: "after-fetch", commandFetchedAt: new Date("2026-08-06T01:25:00.000Z") })
      ],
      releaseBeforeSideEffect: async ({ publishTaskId }) => {
        events.push(`release:${publishTaskId}`);
        return { outboxId: "outbox-1" };
      },
      markTimedOut: async (publishTaskId) => {
        events.push(`timeout:${publishTaskId}`);
        return { timedOut: false };
      },
      countBlocking: async () => 1,
      markStopped: async () => { events.push("stopped"); },
      releaseReservations: async () => { events.push("reservations"); }
    });

    expect(await service.reconcile("run-1", "stop-worker")).toMatchObject({
      status: "STOPPING",
      releaseQueued: 1,
      waitingForPhone: 1
    });
    expect(events).toEqual(["release:before-fetch"]);
  });

  test("turns a fetched command without a result for fifteen minutes into result unknown", async () => {
    const events: string[] = [];
    const service = createPublishInterfaceStopService({
      now: () => now,
      getRunStatus: async () => "STOPPING",
      listInFlight: async () => [task({
        publishTaskId: "timed-out",
        commandFetchedAt: new Date("2026-08-06T01:15:00.000Z")
      })],
      releaseBeforeSideEffect: async () => ({ outboxId: "outbox" }),
      markTimedOut: async (publishTaskId) => {
        events.push(`timeout:${publishTaskId}`);
        return { localResultStatus: "RESULT_UNKNOWN" };
      },
      countBlocking: async () => 1,
      markStopped: async () => undefined,
      releaseReservations: async () => undefined
    });

    expect(await service.reconcile("run-1", "stop-worker")).toMatchObject({ unknown: 1 });
    expect(events).toEqual(["timeout:timed-out"]);
  });

  test("marks stopped before releasing reservations after all work settles", async () => {
    const events: string[] = [];
    const service = createPublishInterfaceStopService({
      now: () => now,
      getRunStatus: async () => "STOPPING",
      listInFlight: async () => [],
      releaseBeforeSideEffect: async () => ({ outboxId: "outbox" }),
      markTimedOut: async () => ({ timedOut: false }),
      countBlocking: async () => 0,
      markStopped: async () => { events.push("stopped"); },
      releaseReservations: async () => { events.push("reservations"); }
    });

    expect(await service.reconcile("run-1", "stop-worker")).toMatchObject({ status: "STOPPED" });
    expect(events).toEqual(["stopped", "reservations"]);
  });
});

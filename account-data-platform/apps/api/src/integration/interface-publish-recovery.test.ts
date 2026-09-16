import { describe, expect, test } from "bun:test";
import {
  createPublishInterfaceRecoveryService
} from "../services/publish-interface-recovery.service";
import {
  createPublishInterfaceResultService,
  type PublishInterfaceResultContext,
  type PublishInterfaceResultRepository
} from "../services/publish-interface-result.service";
import {
  createPublishInterfaceSchedulerCore,
  type PublishInterfaceSchedulerCandidate
} from "../services/publish-interface-scheduler-core";
import { createPublishInterfaceStopService } from "../services/publish-interface-stop.service";
import { createPublishInterfaceWorker } from "../services/publish-interface-worker";

const runConfig = {
  configId: "11111111-1111-4111-8111-111111111111",
  morningPublishTime: "09:00" as const,
  afternoonPublishTime: "15:00" as const,
  maxConcurrentPublishing: 3,
  noMaterialRetryMinutes: 10,
  timezone: "Asia/Shanghai" as const,
  platform: "DOUYIN" as const
};

function run(status: "SCHEDULED" | "RUNNING" | "STOPPING") {
  return { id: "run-recovery", status, ...runConfig };
}

function slotCandidate(slot: "MORNING" | "AFTERNOON", order: number): PublishInterfaceSchedulerCandidate {
  return {
    slotExecutionId: `slot-${slot}`,
    bindingId: "binding-1",
    accountName: "恢复测试账号",
    externalAccountKey: "external-recovery-account",
    priority: slot === "MORNING" ? 0 : 1,
    attemptCount: 0,
    stableOrder: order,
    status: "ELIGIBLE",
    reservationStatus: "RESERVED",
    nextRetryAt: null
  };
}

function resultContext(): PublishInterfaceResultContext {
  return {
    publishTaskId: "publish-result-unknown",
    runId: "run-recovery",
    slotExecutionId: "slot-result-unknown",
    bindingId: "binding-result-unknown",
    deviceCode: "device-recovery",
    businessDate: "2026-08-06",
    slot: "AFTERNOON",
    localResultStatus: null,
    taskStatus: "DISPATCHED",
    dispatchRetryCount: 0,
    dispatchedAt: new Date("2026-08-06T07:00:00.000Z"),
    commandFetchedAt: new Date("2026-08-06T07:00:00.000Z")
  };
}

describe("interface publish recovery integration", () => {
  test("claims morning and afternoon once, then has no third daily claim", async () => {
    const pending = [slotCandidate("MORNING", 0), slotCandidate("AFTERNOON", 1)];
    const claims: string[] = [];
    const scheduler = createPublishInterfaceSchedulerCore({
      getActivePublishingCount: async () => 0,
      listCandidates: async () => pending,
      executeCandidate: async (candidate) => {
        claims.push(candidate.slotExecutionId);
        pending.splice(pending.findIndex((item) => item.slotExecutionId === candidate.slotExecutionId), 1);
        return { kind: "DISPATCHED" };
      }
    });
    const tick = (now: string) => scheduler.tick({
      runId: "run-recovery",
      now: new Date(now),
      maxConcurrentPublishing: 1
    });

    expect(await tick("2026-08-06T01:00:00.000Z")).toMatchObject({ dispatched: 1 });
    expect(await tick("2026-08-06T07:00:00.000Z")).toMatchObject({ dispatched: 1 });
    expect(await tick("2026-08-06T08:00:00.000Z")).toMatchObject({
      claimsAttempted: 0,
      dispatched: 0
    });
    expect(new Set(claims)).toEqual(new Set(["slot-MORNING", "slot-AFTERNOON"]));
  });

  test("STOPPING releases work before action but preserves side-effect-started work", async () => {
    const released: string[] = [];
    const timedOut: string[] = [];
    const stop = createPublishInterfaceStopService({
      now: () => new Date("2026-08-06T08:10:00.000Z"),
      getRunStatus: async () => "STOPPING",
      listInFlight: async () => [
        {
          publishTaskId: "task-before-action",
          taskStatus: "DISPATCHED",
          commandFetchedAt: null,
          sideEffectStartedAt: null,
          localResultStatus: null,
          reportStatus: "REPORT_PENDING"
        },
        {
          publishTaskId: "task-side-effect",
          taskStatus: "RUNNING",
          commandFetchedAt: new Date("2026-08-06T08:00:00.000Z"),
          sideEffectStartedAt: new Date("2026-08-06T08:01:00.000Z"),
          localResultStatus: null,
          reportStatus: "REPORT_PENDING"
        }
      ],
      releaseBeforeSideEffect: async ({ publishTaskId }) => {
        released.push(publishTaskId);
        return { outboxId: "outbox-release" };
      },
      markTimedOut: async (taskId) => {
        timedOut.push(taskId);
        return { timedOut: false };
      },
      countBlocking: async () => 1,
      markStopped: async () => undefined,
      releaseReservations: async () => undefined
    });

    expect(await stop.reconcile("run-recovery", "node19-stop")).toMatchObject({
      status: "STOPPING",
      releaseQueued: 1,
      waitingForPhone: 1,
      unknown: 0
    });
    expect(released).toEqual(["task-before-action"]);
    expect(timedOut).toHaveLength(0);
  });

  test("restart recovery re-enters the scheduler without duplicating persisted claim or command", async () => {
    let persistedTask = false;
    let claims = 0;
    let commands = 0;
    const events: string[] = [];
    const dependencies = {
      recoverActiveRuns: async () => { events.push("recover"); },
      getCurrentRun: async () => run("RUNNING"),
      markRunning: async () => run("RUNNING"),
      runSchedulerTick: async () => {
        events.push("scheduler");
        if (!persistedTask) {
          persistedTask = true;
          claims += 1;
          commands += 1;
        }
        return { dispatched: persistedTask ? 1 : 0 };
      }
    };

    await createPublishInterfaceWorker(dependencies).tick();
    await createPublishInterfaceWorker(dependencies).tick();
    expect(events).toEqual(["recover", "scheduler", "recover", "scheduler"]);
    expect({ claims, commands }).toEqual({ claims: 1, commands: 1 });
  });

  test("recovery handles STOPPING separately and never owns phone-command creation", async () => {
    const events: string[] = [];
    const recovery = createPublishInterfaceRecoveryService({
      listRuns: async () => [
        { id: "run-active", status: "RUNNING", config: runConfig },
        { id: "run-stopping", status: "STOPPING", config: runConfig }
      ],
      recoverReservations: async (runId) => { events.push(`reservations:${runId}`); },
      recoverSchedule: async (runId) => { events.push(`schedule:${runId}`); },
      triggerTick: async (runId) => { events.push(`tick:${runId}`); },
      reconcileStop: async (runId) => { events.push(`stop:${runId}`); },
      startOutbox: () => { events.push("outbox"); },
      now: () => new Date("2026-08-06T02:00:00.000Z")
    });

    expect(await recovery.recover("node19-recovery")).toEqual({ recoveredRuns: 2 });
    expect(events).toEqual([
      "outbox",
      "reservations:run-active",
      "schedule:run-active",
      "tick:run-active",
      "stop:run-stopping"
    ]);
  });

  test("RESULT_UNKNOWN is terminal for automation until evidence-backed resolution", async () => {
    let current = resultContext();
    const events: string[] = [];
    const repository: PublishInterfaceResultRepository = {
      findContext: async () => current,
      savePublished: async () => { events.push("published"); return { localResultStatus: "PUBLISHED" }; },
      scheduleRetry: async () => { events.push("retry"); return { localResultStatus: "FAILED", retryPending: true }; },
      saveFinalFailure: async () => { events.push("failed"); return { localResultStatus: "FAILED" }; },
      saveResultUnknown: async () => {
        events.push("unknown");
        current = { ...current, localResultStatus: "RESULT_UNKNOWN" };
        return { localResultStatus: "RESULT_UNKNOWN", alertId: "alert-unknown" };
      },
      resolveResultUnknown: async (input) => {
        events.push(`resolved:${input.resolution}`);
        current = { ...current, localResultStatus: input.resolution };
        return { localResultStatus: input.resolution };
      }
    };
    const service = createPublishInterfaceResultService({ repository });
    const unknown = { deviceId: "device-recovery", status: "RESULT_UNKNOWN" as const };

    expect(await service.report(current.publishTaskId, unknown, "mobile")).toMatchObject({
      localResultStatus: "RESULT_UNKNOWN"
    });
    expect(await service.report(current.publishTaskId, {
      deviceId: "device-recovery",
      status: "FAILED",
      error: "NETWORK_TIMEOUT"
    }, "mobile")).toMatchObject({ localResultStatus: "RESULT_UNKNOWN", idempotent: true });
    expect(events).toEqual(["unknown"]);
    await expect(service.resolveResultUnknown({
      publishTaskId: current.publishTaskId,
      resolution: "FAILED",
      evidence: " ",
      actor: "admin"
    })).rejects.toThrow("RESULT_UNKNOWN_EVIDENCE_REQUIRED");
    expect(await service.resolveResultUnknown({
      publishTaskId: current.publishTaskId,
      resolution: "FAILED",
      evidence: "人工核对抖音主页未出现该视频",
      actor: "admin"
    })).toMatchObject({ localResultStatus: "FAILED" });
    expect(events).toEqual(["unknown", "resolved:FAILED"]);
  });
});

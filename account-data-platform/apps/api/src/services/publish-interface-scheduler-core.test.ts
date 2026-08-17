import { describe, expect, test } from "bun:test";
import {
  createPublishInterfaceSchedulerCore,
  orderSchedulerCandidates,
  type PublishInterfaceSchedulerCandidate
} from "./publish-interface-scheduler-core";

function candidate(
  accountName: string,
  overrides: Partial<PublishInterfaceSchedulerCandidate> = {}
): PublishInterfaceSchedulerCandidate {
  return {
    slotExecutionId: `slot-${accountName}`,
    bindingId: `binding-${accountName}`,
    accountName,
    priority: 1,
    attemptCount: 0,
    stableOrder: accountName.charCodeAt(0),
    status: "ELIGIBLE",
    reservationStatus: "RESERVED",
    nextRetryAt: null,
    ...overrides
  };
}

describe("interface publish scheduler core", () => {
  test("uses N+1 replacement without letting no-material consume a publishing slot", async () => {
    const calls: string[] = [];
    const outcomes = new Map<string, "DISPATCHED" | "NO_MATERIAL">([
      ["A", "DISPATCHED"],
      ["B", "NO_MATERIAL"],
      ["C", "DISPATCHED"],
      ["D", "DISPATCHED"]
    ]);
    const scheduler = createPublishInterfaceSchedulerCore({
      getActivePublishingCount: async () => 0,
      listCandidates: async () => [candidate("A"), candidate("B"), candidate("C"), candidate("D")],
      executeCandidate: async (item) => {
        calls.push(item.accountName);
        return { kind: outcomes.get(item.accountName) ?? "REJECTED" };
      }
    });

    const result = await scheduler.tick({
      runId: "run-1",
      now: new Date("1970-01-01T02:00:00.000Z"),
      maxConcurrentPublishing: 3
    });

    expect(calls).toEqual(["A", "B", "C", "D"]);
    expect(result).toEqual({
      freeSlotsBefore: 3,
      claimsAttempted: 4,
      dispatched: 3,
      noMaterial: 1,
      waitingDevice: 0
    });
  });

  test("does not call the claim executor when capacity is full or no candidate is eligible", async () => {
    let claimCalls = 0;
    let listCalls = 0;
    const fullScheduler = createPublishInterfaceSchedulerCore({
      getActivePublishingCount: async () => 3,
      listCandidates: async () => {
        listCalls += 1;
        return [candidate("A")];
      },
      executeCandidate: async () => {
        claimCalls += 1;
        return { kind: "DISPATCHED" };
      }
    });
    const input = {
      runId: "run-full",
      now: new Date("2026-08-06T02:00:00.000Z"),
      maxConcurrentPublishing: 3
    };

    expect((await fullScheduler.tick(input)).claimsAttempted).toBe(0);
    expect(listCalls).toBe(0);

    const emptyScheduler = createPublishInterfaceSchedulerCore({
      getActivePublishingCount: async () => 0,
      listCandidates: async () => [
        candidate("published", { status: "PUBLISHED" }),
        candidate("waiting", { reservationStatus: "WAITING_DEVICE" }),
        candidate("retry", { nextRetryAt: new Date("2026-08-06T02:10:01.000Z") })
      ],
      executeCandidate: async () => {
        claimCalls += 1;
        return { kind: "DISPATCHED" };
      }
    });

    expect((await emptyScheduler.tick(input)).claimsAttempted).toBe(0);
    expect(claimCalls).toBe(0);
  });

  test("processes fifty bindings through one candidate scan and serial executor", async () => {
    const candidates = Array.from({ length: 50 }, (_, index) => candidate(`account-${index}`, {
      stableOrder: index
    }));
    let listCalls = 0;
    let activeExecutors = 0;
    let maxActiveExecutors = 0;
    const scheduler = createPublishInterfaceSchedulerCore({
      getActivePublishingCount: async () => 0,
      listCandidates: async () => {
        listCalls += 1;
        return candidates;
      },
      executeCandidate: async () => {
        activeExecutors += 1;
        maxActiveExecutors = Math.max(maxActiveExecutors, activeExecutors);
        await Promise.resolve();
        activeExecutors -= 1;
        return { kind: "NO_MATERIAL" };
      }
    });

    const result = await scheduler.tick({
      runId: "run-50",
      now: new Date("1970-01-01T02:00:00.000Z"),
      maxConcurrentPublishing: 3
    });

    expect(listCalls).toBe(1);
    expect(maxActiveExecutors).toBe(1);
    expect(result.claimsAttempted).toBe(50);
    expect(result.noMaterial).toBe(50);
  });

  test("rotates the daily starting account and puts retries after first opportunities", () => {
    const candidates = [
      candidate("A", { attemptCount: 1 }),
      candidate("B"),
      candidate("C")
    ];

    expect(orderSchedulerCandidates(candidates, "1970-01-01").map((item) => item.accountName))
      .toEqual(["B", "C", "A"]);
    expect(orderSchedulerCandidates(candidates, "1970-01-02").map((item) => item.accountName))
      .toEqual(["C", "B", "A"]);
  });
});

import { describe, expect, test } from "bun:test";
import type {
  InterfacePublishReservationCandidate,
  PublishInterfaceReservationRepository
} from "../repositories/publish-interface-reservation.repository";
import { createPublishInterfaceReservationService } from "./publish-interface-reservation.service";

function candidate(index: number): InterfacePublishReservationCandidate {
  return {
    id: crypto.randomUUID(),
    runId: "11111111-1111-4111-8111-111111111111",
    deviceId: crypto.randomUUID(),
    deviceCode: `device-${String(index).padStart(2, "0")}`,
    accountName: `账号-${index}`,
    accountNo: String(10000 + index),
    externalAccountKey: `external-${index}`,
    noMaterialRetryMinutes: 10,
    nextReservationRetryAt: null
  };
}

function fakeRepository(input: {
  candidates: InterfacePublishReservationCandidate[];
  deviceStates?: Record<string, "ONLINE" | "OFFLINE" | "BUSY">;
  runStatus?: "SCHEDULED" | "RUNNING" | "STOPPING" | "STOPPED";
}) {
  const states = input.deviceStates ?? {};
  const reserved = new Set<string>();
  const released: string[] = [];
  const attempts: string[] = [];
  const nextRetry = new Map<string, Date>();
  let runStatus = input.runStatus ?? "SCHEDULED";

  const repository: PublishInterfaceReservationRepository = {
    async listCandidates(_runId, now) {
      return input.candidates.filter((item) =>
        !reserved.has(item.id)
        && (!nextRetry.has(item.id) || nextRetry.get(item.id)!.getTime() <= now.getTime())
      );
    },
    async reserveOne(runBindingId, _now, nextRetryAt) {
      attempts.push(runBindingId);
      const item = input.candidates.find((entry) => entry.id === runBindingId)!;
      const state = states[item.deviceCode] ?? "ONLINE";
      if (state === "OFFLINE" || state === "BUSY") {
        nextRetry.set(item.id, nextRetryAt);
        return { kind: state === "OFFLINE" ? "DEVICE_OFFLINE" : "DEVICE_BUSY" } as const;
      }
      reserved.add(item.id);
      return { kind: "RESERVED", assignmentId: crypto.randomUUID() } as const;
    },
    async findRunStatus() {
      return runStatus;
    },
    async releaseAll(runId) {
      released.push(runId);
      const count = reserved.size;
      reserved.clear();
      return count;
    },
    async listActiveRunIds() {
      return runStatus === "STOPPED" ? [] : [input.candidates[0]?.runId ?? ""];
    }
  };
  return {
    repository,
    attempts,
    reserved,
    released,
    nextRetry,
    states,
    setRunStatus(status: typeof runStatus) { runStatus = status; }
  };
}

describe("interface publish device reservation", () => {
  test("does not take over a device with another active assignment", async () => {
    const item = candidate(1);
    const fake = fakeRepository({ candidates: [item], deviceStates: { [item.deviceCode]: "BUSY" } });
    const service = createPublishInterfaceReservationService({
      repository: fake.repository,
      now: () => new Date("2026-08-06T01:00:00.000Z")
    });
    expect(await service.reconcile(item.runId, "worker")).toEqual({
      checked: 1,
      reserved: 0,
      waitingOffline: 0,
      waitingBusy: 1
    });
    expect(fake.reserved.size).toBe(0);
  });

  test("reconciles fifty snapshots as finite database operations without per-device timers", async () => {
    const items = Array.from({ length: 50 }, (_, index) => candidate(index));
    const fake = fakeRepository({ candidates: items });
    const service = createPublishInterfaceReservationService({
      repository: fake.repository,
      now: () => new Date("2026-08-06T01:00:00.000Z")
    });
    expect(await service.reconcile(items[0]!.runId, "worker")).toMatchObject({ checked: 50, reserved: 50 });
    expect(fake.attempts).toHaveLength(50);
  });

  test("keeps an offline device waiting for ten minutes and reserves it after recovery", async () => {
    const item = candidate(1);
    const fake = fakeRepository({ candidates: [item], deviceStates: { [item.deviceCode]: "OFFLINE" } });
    let now = new Date("2026-08-06T01:00:00.000Z");
    const service = createPublishInterfaceReservationService({ repository: fake.repository, now: () => now });

    expect((await service.reconcile(item.runId, "worker")).waitingOffline).toBe(1);
    now = new Date("2026-08-06T01:09:59.000Z");
    expect((await service.reconcile(item.runId, "worker")).checked).toBe(0);
    fake.states[item.deviceCode] = "ONLINE";
    now = new Date("2026-08-06T01:10:00.000Z");
    expect((await service.reconcile(item.runId, "worker")).reserved).toBe(1);
  });

  test("defers release while stopping and releases idempotently after stopped", async () => {
    const item = candidate(1);
    const fake = fakeRepository({ candidates: [item], runStatus: "SCHEDULED" });
    const service = createPublishInterfaceReservationService({ repository: fake.repository });
    await service.reconcile(item.runId, "worker");
    fake.setRunStatus("STOPPING");
    expect(await service.releaseAll(item.runId, "worker")).toEqual({ released: 0, deferred: true });
    expect(fake.released).toHaveLength(0);
    fake.setRunStatus("STOPPED");
    expect(await service.releaseAll(item.runId, "worker")).toEqual({ released: 1, deferred: false });
    expect(await service.releaseAll(item.runId, "worker")).toEqual({ released: 0, deferred: false });
    expect(fake.released).toHaveLength(2);
  });
});

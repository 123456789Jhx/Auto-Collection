import { describe, expect, test } from "bun:test";
import type { InterfacePublishRunConfig } from "@pkg/types";
import type {
  ConfirmInterfacePublishRunInput,
  CreateInterfacePublishRunInput,
  PublishInterfaceRunRepository,
  PublishInterfaceRunRow
} from "../repositories/publish-interface-run.repository";
import {
  createPublishInterfaceRunService,
  PublishInterfaceRunServiceError
} from "./publish-interface-run.service";

const runConfig: InterfacePublishRunConfig = {
  configId: "11111111-1111-4111-8111-111111111111",
  morningPublishTime: "09:00",
  afternoonPublishTime: "15:00",
  maxConcurrentPublishing: 3,
  noMaterialRetryMinutes: 10,
  timezone: "Asia/Shanghai",
  platform: "DOUYIN"
};

function fakeRunRepository() {
  let activeRun: PublishInterfaceRunRow | null = null;
  const confirmed: ConfirmInterfacePublishRunInput[] = [];
  const created: string[] = [];
  const repository: PublishInterfaceRunRepository = {
    async create(input: CreateInterfacePublishRunInput) {
      if (activeRun && !["STOPPED", "FAILED", "CANCELED"].includes(activeRun.status)) {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }
      activeRun = {
        id: crypto.randomUUID(),
        status: "CHECKING_BINDINGS",
        ...input.config
      };
      created.push(activeRun.id);
      return activeRun;
    },
    async findById(runId) {
      return activeRun?.id === runId ? activeRun : null;
    },
    async findCurrent() {
      return activeRun && !["STOPPED", "FAILED", "CANCELED"].includes(activeRun.status) ? activeRun : null;
    },
    async countBindingsWithoutPublishedSlot() {
      return 0;
    },
    async transition(runId, expected, status) {
      if (!activeRun || activeRun.id !== runId || !expected.includes(activeRun.status)) return null;
      activeRun = { ...activeRun, status };
      return activeRun;
    },
    async confirm(input) {
      if (!activeRun || activeRun.id !== input.runId || activeRun.status !== "WAITING_USER_CONFIRMATION") {
        return null;
      }
      confirmed.push(input);
      activeRun = { ...activeRun, status: "SCHEDULED" };
      return { run: activeRun, bindings: input.bindings };
    }
  };
  return {
    repository,
    confirmed,
    created,
    get activeRun() { return activeRun; }
  };
}

const preflightRows = [
  {
    bindingId: "21111111-1111-4111-8111-111111111111",
    deviceId: "31111111-1111-4111-8111-111111111111",
    deviceCode: "matched",
    deviceName: "Matched",
    accountName: "账号 A",
    accountNo: "10001",
    externalAccountKey: "10001",
    status: "MATCHED" as const
  },
  {
    bindingId: "22222222-2222-4222-8222-222222222222",
    deviceId: "32222222-2222-4222-8222-222222222222",
    deviceCode: "offline",
    deviceName: "Offline",
    accountName: "账号 B",
    accountNo: "10002",
    externalAccountKey: "10002",
    status: "DEVICE_OFFLINE" as const
  },
  {
    bindingId: "23333333-3333-4333-8333-333333333333",
    deviceId: "33333333-3333-4333-8333-333333333333",
    deviceCode: "busy",
    deviceName: "Busy",
    accountName: "账号 C",
    accountNo: "10003",
    externalAccountKey: "10003",
    status: "DEVICE_BUSY" as const
  },
  {
    bindingId: "24444444-4444-4444-8444-444444444444",
    deviceId: "34444444-4444-4444-8444-444444444444",
    deviceCode: "incomplete",
    deviceName: "Incomplete",
    accountName: "账号 D",
    accountNo: null,
    externalAccountKey: null,
    status: "BINDING_INCOMPLETE" as const
  },
  {
    bindingId: null,
    deviceId: "35555555-5555-4555-8555-555555555555",
    deviceCode: "unbound",
    deviceName: "Unbound",
    accountName: null,
    accountNo: null,
    externalAccountKey: null,
    status: "UNBOUND" as const
  }
];

describe("interface publish run service", () => {
  test("creates a persisted run and returns preflight without external or phone side effects", async () => {
    const fake = fakeRunRepository();
    let preflightCalls = 0;
    const service = createPublishInterfaceRunService({
      repository: fake.repository,
      preflight: async () => { preflightCalls += 1; return preflightRows; },
      now: () => new Date("2026-08-06T00:00:00.000Z")
    });
    const result = await service.create(runConfig, "admin");
    expect(result.run.status).toBe("WAITING_USER_CONFIRMATION");
    expect(result.preflight).toEqual(preflightRows);
    expect(preflightCalls).toBe(1);
    expect(fake.confirmed).toHaveLength(0);
  });

  test("snapshots only complete bindings and keeps skipped, offline and busy states run-local", async () => {
    const fake = fakeRunRepository();
    const service = createPublishInterfaceRunService({
      repository: fake.repository,
      preflight: async () => preflightRows,
      now: () => new Date("2026-08-06T00:00:00.000Z")
    });
    const created = await service.create(runConfig, "admin");
    const confirmed = await service.confirm(created.run.id, {
      skippedBindingIds: [preflightRows[2]!.bindingId!]
    }, "admin");
    expect(confirmed.run.status).toBe("SCHEDULED");
    expect(confirmed.bindings.map((item) => ({
      deviceCode: item.deviceCode,
      status: item.status,
      reservationStatus: item.reservationStatus
    }))).toEqual([
      { deviceCode: "matched", status: "MATCHED", reservationStatus: "WAITING_DEVICE" },
      { deviceCode: "offline", status: "DEVICE_OFFLINE", reservationStatus: "WAITING_DEVICE" },
      { deviceCode: "busy", status: "SKIPPED_FOR_RUN", reservationStatus: "RELEASED" }
    ]);
  });

  test("maps the database active-run constraint and permits a new id only after stop", async () => {
    const fake = fakeRunRepository();
    const service = createPublishInterfaceRunService({
      repository: fake.repository,
      preflight: async () => preflightRows,
      now: () => new Date("2026-08-06T00:00:00.000Z")
    });
    const first = await service.create(runConfig, "admin");
    await expect(service.create(runConfig, "admin")).rejects.toBeInstanceOf(PublishInterfaceRunServiceError);
    await service.confirm(first.run.id, { skippedBindingIds: [] }, "admin");
    await service.requestStop(first.run.id, "admin");
    await service.markStopped(first.run.id, "admin");
    const second = await service.create(runConfig, "admin");
    expect(second.run.id).not.toBe(first.run.id);
    expect(fake.created).toHaveLength(2);
  });
});

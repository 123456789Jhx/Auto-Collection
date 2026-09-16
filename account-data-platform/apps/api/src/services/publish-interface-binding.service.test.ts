import { describe, expect, test } from "bun:test";
import {
  createPublishInterfaceBindingService,
  PublishInterfaceBindingServiceError
} from "./publish-interface-binding.service";
import type {
  InterfacePublishBindingRepository,
  InterfacePublishBindingRow
} from "../repositories/publish-interface-binding.repository";

function row(overrides: Partial<InterfacePublishBindingRow> = {}): InterfacePublishBindingRow {
  return {
    deviceId: crypto.randomUUID(),
    deviceCode: `device-${crypto.randomUUID().slice(0, 6)}`,
    deviceName: "Test phone",
    deviceStatus: "online",
    lastHeartbeatAt: new Date("2026-08-06T01:59:00.000Z"),
    bindingId: crypto.randomUUID(),
    accountName: "开心幸福一家人",
    accountNo: "41218954470",
    externalAccountKey: `external-${overrides.deviceCode ?? "test-account"}`,
    bindingEnabled: true,
    activeAssignmentId: null,
    ...overrides
  };
}

function fakeRepository(initial: InterfacePublishBindingRow[]) {
  const rows = initial;
  const repository: InterfacePublishBindingRepository = {
    async listBindings() {
      return rows;
    },
    async listActiveBindingsForPreflight() {
      return rows.map((item) => item.bindingEnabled ? item : {
        ...item,
        bindingId: null,
        accountName: null,
        accountNo: null,
        externalAccountKey: null,
        bindingEnabled: null
      });
    },
    async findDeviceByCode(deviceCode) {
      return rows.find((item) => item.deviceCode === deviceCode) ?? null;
    },
    async saveBinding(input) {
      if (input.enabled && rows.some((item) =>
        item.bindingEnabled
        && item.deviceCode !== input.deviceCode
        && item.accountName === input.accountName
      )) {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }
      const existing = rows.find((item) => item.deviceCode === input.deviceCode);
      if (!existing) throw new Error("device missing");
      Object.assign(existing, {
        bindingId: existing.bindingId ?? crypto.randomUUID(),
        accountName: input.accountName,
        accountNo: input.accountNo,
        externalAccountKey: input.externalAccountKey,
        bindingEnabled: input.enabled
      });
      return existing;
    },
    async softDeleteBinding(deviceCode) {
      const existing = rows.find((item) => item.deviceCode === deviceCode && item.bindingId);
      if (!existing) return null;
      existing.bindingId = null;
      existing.accountName = null;
      existing.accountNo = null;
      existing.externalAccountKey = null;
      existing.bindingEnabled = null;
      return { deviceCode };
    }
  };
  return { repository, rows };
}

describe("interface publish binding service", () => {
  test("enforces one enabled Douyin account per device and one device per account", async () => {
    const first = row({ deviceCode: "device-01" });
    const second = row({
      deviceCode: "device-02",
      bindingId: null,
      accountName: null,
      accountNo: null,
      externalAccountKey: null,
      bindingEnabled: null
    });
    const fake = fakeRepository([first, second]);
    const service = createPublishInterfaceBindingService(fake.repository);

    await expect(service.save("device-02", {
      accountName: " 开心幸福一家人 ",
      accountNo: " 41218954470 ",
      externalAccountKey: " external-device-01 ",
      enabled: true
    }, "admin")).rejects.toBeInstanceOf(PublishInterfaceBindingServiceError);

    await service.save("device-01", {
      accountName: "新的账号",
      accountNo: "90001",
      externalAccountKey: " external-90001 ",
      enabled: true
    }, "admin");
    expect(fake.rows.filter((item) => item.deviceCode === "device-01" && item.bindingEnabled)).toHaveLength(1);
    expect(fake.rows[0]?.accountName).toBe("新的账号");
    expect(fake.rows[0]?.externalAccountKey).toBe("external-90001");
  });

  test("returns incomplete, offline, busy, unbound and matched without phone verification", async () => {
    const fake = fakeRepository([
      row({ deviceCode: "incomplete", accountName: "账号-incomplete", accountNo: null }),
      row({ deviceCode: "offline", accountName: "账号-offline", lastHeartbeatAt: new Date("2026-08-06T01:50:00.000Z") }),
      row({ deviceCode: "busy", accountName: "账号-busy", activeAssignmentId: crypto.randomUUID() }),
      row({ deviceCode: "unbound", bindingId: null, accountName: null, accountNo: null, externalAccountKey: null, bindingEnabled: null }),
      row({ deviceCode: "matched", accountName: "账号-matched" })
    ]);
    const service = createPublishInterfaceBindingService(
      fake.repository,
      () => new Date("2026-08-06T02:00:00.000Z")
    );

    const result = await service.preflight();
    expect(Object.fromEntries(result.map((item) => [item.deviceCode, item.status]))).toEqual({
      incomplete: "BINDING_INCOMPLETE",
      offline: "DEVICE_OFFLINE",
      busy: "DEVICE_BUSY",
      unbound: "UNBOUND",
      matched: "MATCHED"
    });
  });

  test("rejects blank account fields before writing", async () => {
    const fake = fakeRepository([row({ deviceCode: "device-01" })]);
    const service = createPublishInterfaceBindingService(fake.repository);
    await expect(service.save("device-01", {
      accountName: " ",
      accountNo: "41218954470",
      externalAccountKey: "external-41218954470",
      enabled: true
    }, "admin")).rejects.toMatchObject({ code: "BINDING_INCOMPLETE" });
  });
});

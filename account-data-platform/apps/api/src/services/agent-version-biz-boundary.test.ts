import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { agentUpdateEvents, collectorDevices } from "@pkg/db/schema";
import { db } from "../repositories/db";
import * as versions from "../repositories/agent-version.repository";
import * as devices from "../repositories/device.repository";
import * as delivery from "./biz-script-delivery.service";
import { getAgentVersionCheck, publishAgentVersion, saveAgentUpdateEvent } from "./agent-version.service";

const restores: Array<{ mockRestore(): void }> = [];
afterEach(() => { for (const spy of restores) spy.mockRestore(); restores.length = 0; });

describe("business channel isolation", () => {
  test("rejects old unscoped publication before touching persistence", async () => {
    restores.push(spyOn(versions, "findAgentVersion").mockResolvedValue(null as never));
    restores.push(spyOn(versions, "createAgentVersion").mockResolvedValue({ id: "legacy" } as never));
    await expect(publishAgentVersion({
      version: "20260910.1", channel: "biz-scripts", entryFile: "biz-script-manifest.json",
      forceUpdate: false, status: "PUBLISHED"
    })).rejects.toThrow("SCOPED_RELEASE_REQUIRED");
  });

  test("business checks use scoped delivery and never pass business versions into APK metadata", async () => {
    let writes = 0;
    restores.push(spyOn(devices, "findDeviceByToken").mockResolvedValue({ id: "device-1", deviceCode: "phone-1", enabled: true } as never));
    restores.push(spyOn(devices, "resolveDeviceByToken").mockImplementation(async () => {
      writes += 1;
      return { id: "device-1", deviceCode: "phone-1", enabled: true } as never;
    }));
    restores.push(spyOn(versions, "findLatestPublishedAgentVersion").mockResolvedValue({ version: "99999999.1", forceUpdate: true } as never));
    restores.push(spyOn(delivery, "findScopedBizScriptVersion").mockResolvedValue(null));
    const result = await getAgentVersionCheck("phone-1", "20260910.1", "biz-scripts", "token");
    expect(result.updateAvailable).toBe(false);
    expect(writes).toBe(0);
  });

  test("business update events do not write shared device APK state", async () => {
    const writes: unknown[] = [];
    restores.push(spyOn(db, "insert").mockImplementation((table) => ({ values: () => ({ returning: async () => {
      writes.push(table);
      return [{ id: "event-1" }];
    } }) }) as never));
    restores.push(spyOn(db, "update").mockImplementation((table) => ({ set: () => ({ where: async () => { writes.push(table); } }) }) as never));
    await versions.createAgentUpdateEvent({
      tenantId: "default", deviceId: "device-1", eventType: "APPLIED", toVersion: "20260910.2",
      payloadJson: { channel: "biz-scripts" }
    });
    expect(writes).toHaveLength(1);
    expect(writes[0] === agentUpdateEvents).toBe(true);
    expect(writes.includes(collectorDevices)).toBe(false);
  });

  test("business event authentication does not rewrite the APK appVersion column", async () => {
    let writes = 0;
    restores.push(spyOn(devices, "findDeviceByToken").mockResolvedValue({ id: "device-1", deviceCode: "phone-1", enabled: true } as never));
    restores.push(spyOn(devices, "resolveDeviceByToken").mockImplementation(async () => {
      writes += 1;
      return { id: "device-1", deviceCode: "phone-1", enabled: true } as never;
    }));
    restores.push(spyOn(versions, "findAgentVersion").mockResolvedValue(null as never));
    restores.push(spyOn(versions, "createAgentUpdateEvent").mockResolvedValue({ id: "event-1" } as never));
    await saveAgentUpdateEvent({ deviceId: "phone-1", eventType: "CHECKED", fromVersion: "20260910.1", payload: { channel: "biz-scripts" } }, "token");
    expect(writes).toBe(0);
  });
});

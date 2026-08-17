import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createInMemoryDeviceRecoveryRepository } from "./device-recovery.repository";
import { createDeviceRecoveryRoutes } from "./device-recovery.routes";
import { createDeviceRecoveryService } from "./device-recovery.service";

const device = {
  id: "10000000-0000-4000-8000-000000000001",
  deviceCode: "device-mi8"
};

function fixture() {
  const service = createDeviceRecoveryService({
    repository: createInMemoryDeviceRecoveryRepository([device])
  });
  const routes = createDeviceRecoveryRoutes({ service });
  const app = new Hono();
  app.route("/mobile/device-recovery", routes.mobile);
  app.route("/admin/device-recovery", routes.admin);
  return app;
}

describe("device recovery routes", () => {
  test("reports a stage and returns the latest timeline", async () => {
    const app = fixture();
    const reported = await app.request("/mobile/device-recovery/stages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: device.deviceCode,
        bootId: "boot-a",
        eventKey: "boot-a:SYSTEM_BOOTED",
        source: "AUTO_BOOT",
        stage: "SYSTEM_BOOTED",
        occurredAt: "2026-08-12T01:00:00.000Z",
        reportedAt: "2026-08-12T01:00:05.000Z"
      })
    });
    const queried = await app.request(`/admin/device-recovery/devices/${device.deviceCode}/latest`);

    expect(reported.status).toBe(202);
    expect((await reported.json() as any).data.duplicate).toBe(false);
    expect(queried.status).toBe(200);
    expect((await queried.json() as any).data.events).toHaveLength(1);
  });

  test("returns validation and not-found errors", async () => {
    const app = fixture();
    const invalid = await app.request("/mobile/device-recovery/stages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: "" })
    });
    const missing = await app.request("/admin/device-recovery/devices/missing/latest");

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
  });
});

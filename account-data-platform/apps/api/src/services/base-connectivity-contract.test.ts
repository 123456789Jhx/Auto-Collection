import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { updateBaseConnectivityThresholdSchema } from "@pkg/types";

const apiRoot = path.join(import.meta.dir, "..");
const workspaceRoot = path.join(import.meta.dir, "../../../..");

describe("base connectivity persistence contract", () => {
  test("accepts only a per-device threshold from 15 to 150 seconds", () => {
    expect(updateBaseConnectivityThresholdSchema.parse({ offlineThresholdSeconds: 15 })).toEqual({ offlineThresholdSeconds: 15 });
    expect(updateBaseConnectivityThresholdSchema.parse({ offlineThresholdSeconds: 150 })).toEqual({ offlineThresholdSeconds: 150 });
    expect(updateBaseConnectivityThresholdSchema.safeParse({ offlineThresholdSeconds: 14 }).success).toBe(false);
    expect(updateBaseConnectivityThresholdSchema.safeParse({ offlineThresholdSeconds: 151 }).success).toBe(false);
    expect(updateBaseConnectivityThresholdSchema.safeParse({ offlineThresholdSeconds: 15.5 }).success).toBe(false);
  });

  test("stores server receive time and returns the latest threshold", () => {
    const service = readFileSync(path.join(apiRoot, "services/mobile.service.ts"), "utf8");
    const route = readFileSync(path.join(apiRoot, "routes/mobile.ts"), "utf8");

    expect(service).toContain("const receivedAt = new Date()");
    expect(service).toContain("saveDeviceBaseConnectivityHeartbeat(device.id, {");
    expect(service).toContain("receivedAt,");
    expect(service).toContain("screenState: payload.screenState");
    expect(service).toContain("appUiState: payload.appUiState");
    expect(route).toContain("offlineThresholdSeconds: device.baseOfflineThresholdSeconds");
  });

  test("persists a default threshold and exposes a dedicated settings route", () => {
    const schema = readFileSync(path.join(workspaceRoot, "packages/db/src/schema.ts"), "utf8");
    const migration = readFileSync(path.join(workspaceRoot, "packages/db/src/migrations/0036_base_connectivity_threshold.sql"), "utf8");
    const adminRoute = readFileSync(path.join(apiRoot, "routes/admin.ts"), "utf8");

    expect(schema).toContain('baseOfflineThresholdSeconds: integer("base_offline_threshold_seconds").notNull().default(15)');
    expect(migration).toContain('"base_offline_threshold_seconds" integer DEFAULT 15 NOT NULL');
    expect(adminRoute).toContain('adminRoutes.patch("/devices/:deviceCode/base-connectivity"');
    expect(adminRoute).not.toContain('commandType: "REFRESH_CONFIG"');
  });
});

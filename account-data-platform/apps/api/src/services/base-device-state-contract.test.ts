import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mobileBaseConnectivityHeartbeatSchema } from "@pkg/types";
import { mapDeviceStatus } from "./admin.service";

const workspaceRoot = path.join(import.meta.dir, "../../../..");
const apiRoot = path.join(import.meta.dir, "..");

describe("outer base device-state contract", () => {
  test("accepts screen and App UI state while defaulting an older APK to unknown", () => {
    expect(mobileBaseConnectivityHeartbeatSchema.parse({
      deviceId: "mi-8-001",
      screenState: "locked",
      appUiState: "background"
    })).toEqual({
      deviceId: "mi-8-001",
      screenState: "locked",
      appUiState: "background"
    });
    expect(mobileBaseConnectivityHeartbeatSchema.parse({ deviceId: "mi-8-001" })).toEqual({
      deviceId: "mi-8-001",
      screenState: "unknown",
      appUiState: "unknown"
    });
    expect(mobileBaseConnectivityHeartbeatSchema.safeParse({
      deviceId: "mi-8-001",
      screenState: "unlocked",
      appUiState: "invalid"
    }).success).toBe(false);
  });

  test("persists both child states only through the new outer heartbeat", () => {
    const repository = readFileSync(path.join(apiRoot, "repositories/device.repository.ts"), "utf8");
    const service = readFileSync(path.join(apiRoot, "services/mobile.service.ts"), "utf8");
    const route = readFileSync(path.join(apiRoot, "routes/mobile.ts"), "utf8");

    expect(repository).toContain("screenState: values.screenState");
    expect(repository).toContain("appUiState: values.appUiState");
    expect(service).toContain("screenState: payload.screenState");
    expect(service).toContain("appUiState: payload.appUiState");
    expect(route).toContain("appUiState: parsed.data.appUiState");
  });

  test("legacy base heartbeat cannot overwrite outer connectivity child states", () => {
    const repository = readFileSync(path.join(apiRoot, "repositories/device.repository.ts"), "utf8");
    const start = repository.indexOf("export async function saveBaseHeartbeat");
    const end = repository.indexOf("export async function saveBaseConnectivityHeartbeat", start);
    const legacyBlock = repository.slice(start, end);

    expect(legacyBlock).not.toContain('baseStatus: "online"');
    expect(legacyBlock).not.toContain("baseLastHeartbeatAt:");
    expect(legacyBlock).not.toContain("screenState:");
    expect(legacyBlock).not.toContain("appUiState:");
  });

  test("returns unknown child states whenever the outer parent is unavailable", () => {
    const online = mapDeviceStatus({
      lastHeartbeatAt: null,
      status: "offline",
      baseStatus: "online",
      baseLastHeartbeatAt: new Date(),
      screenState: "locked",
      appUiState: "background"
    });
    expect(online.screenState).toBe("locked");
    expect(online.appUiState).toBe("background");

    const offline = mapDeviceStatus({
      lastHeartbeatAt: null,
      status: "offline",
      baseStatus: "online",
      baseLastHeartbeatAt: new Date(Date.now() - 151_000),
      baseOfflineThresholdSeconds: 150,
      screenState: "locked",
      appUiState: "background"
    });
    expect(offline.screenState).toBe("unknown");
    expect(offline.appUiState).toBe("unknown");
  });

  test("adds database storage for App UI state", () => {
    const schema = readFileSync(path.join(workspaceRoot, "packages/db/src/schema.ts"), "utf8");
    const migration = readFileSync(path.join(workspaceRoot, "packages/db/src/migrations/0037_app_ui_state.sql"), "utf8");
    expect(schema).toContain('appUiState: varchar("app_ui_state", { length: 32 }).notNull().default("unknown")');
    expect(migration).toContain('"app_ui_state" varchar(32) DEFAULT \'unknown\' NOT NULL');
  });
});

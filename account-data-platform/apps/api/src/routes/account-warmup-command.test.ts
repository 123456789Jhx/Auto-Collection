import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, mobileCommands } from "@pkg/db/schema";
import { and, eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../repositories/db";

const suffix = crypto.randomUUID().replaceAll("-", "");
const deviceCode = `warmup-device-${suffix.slice(0, 10)}`;
const deviceToken = `${suffix}${suffix}`;
const batchId = crypto.randomUUID();
let adminToken = "";
let deviceId = "";

function adminRequest(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeAll(async () => {
  const login = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: "root" })
  });
  adminToken = (await login.json()).token;
  await app.request("/api/v1/mobile/device-token/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: deviceCode, deviceToken, platform: "android", appVersion: "warmup-test" })
  });
  const device = await db.query.collectorDevices.findFirst({ where: eq(collectorDevices.deviceCode, deviceCode) });
  deviceId = device?.id ?? "";
});

afterAll(async () => {
  if (deviceId) await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
  await db.delete(collectorDevices).where(eq(collectorDevices.deviceCode, deviceCode));
});

describe("account warmup mobile commands", () => {
  test("stores normalized target-live payload and allows a scoped stop command", async () => {
    const start = await adminRequest("/api/v1/admin/mobile-commands", {
      deviceId: deviceCode,
      commandType: "ACCOUNT_WARMUP_RUN",
      payload: {
        featureKey: "target_live_interaction",
        batchId,
        config: {
          targetKeyword: "  药材种植 ",
          relatedTerms: [" 当归 ", "三七", "当归"],
          singleLiveDurationMinutes: 10,
          totalWarmupDurationMinutes: 60,
          maxRounds: 3,
          candidatesPerRound: 4
        }
      }
    });
    expect(start.status).toBe(201);
    const created = await start.json();
    expect(created.payloadJson).toMatchObject({
      batchId,
      featureKey: "target_live_interaction",
      config: {
        targetKeyword: "药材种植",
        relatedTerms: ["当归", "三七"],
        singleLiveDurationMinutes: 10,
        totalWarmupDurationMinutes: 60
      }
    });

    const stop = await adminRequest("/api/v1/admin/mobile-commands", {
      deviceId: deviceCode,
      commandType: "ACCOUNT_WARMUP_STOP",
      payload: { batchId, targetCommandId: created.id }
    });
    expect(stop.status).toBe(201);
  });

  test("rejects target-live commands without related terms", async () => {
    const response = await adminRequest("/api/v1/admin/mobile-commands", {
      deviceId: deviceCode,
      commandType: "ACCOUNT_WARMUP_RUN",
      payload: {
        featureKey: "target_live_interaction",
        batchId: crypto.randomUUID(),
        config: { targetKeyword: "药材种植", relatedTerms: [] }
      }
    });
    expect(response.status).toBe(400);
  });

  test("creates a live comment entry command with normalized keyword and viewer floor", async () => {
    const response = await adminRequest("/api/v1/admin/mobile-commands", {
      deviceId: deviceCode,
      commandType: "ACCOUNT_WARMUP_RUN",
      payload: {
        featureKey: "live_comment_entry",
        batchId: crypto.randomUUID(),
        config: { targetKeyword: "  药材种植  ", minViewerCount: 0 }
      }
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.payloadJson).toMatchObject({
      featureKey: "live_comment_entry",
      config: { targetKeyword: "药材种植", minViewerCount: 0 }
    });
  });

  test("rejects a live comment entry command with a negative viewer floor", async () => {
    const response = await adminRequest("/api/v1/admin/mobile-commands", {
      deviceId: deviceCode,
      commandType: "ACCOUNT_WARMUP_RUN",
      payload: {
        featureKey: "live_comment_entry",
        batchId: crypto.randomUUID(),
        config: { targetKeyword: "测试", minViewerCount: -1 }
      }
    });
    expect(response.status).toBe(400);
  });

  test("creates one video stop command per device and batch", async () => {
    const stopBatchId = crypto.randomUUID();
    const payload = {
      deviceId: deviceCode,
      commandType: "VIDEO_WARMUP_STOP",
      payload: {
        featureKey: "video_warmup",
        batchId: stopBatchId,
        reason: "USER_REQUESTED"
      }
    };

    const first = await adminRequest("/api/v1/admin/mobile-commands", payload);
    const second = await adminRequest("/api/v1/admin/mobile-commands", payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstCommand = await first.json();
    const secondCommand = await second.json();
    expect(secondCommand.id).toBe(firstCommand.id);
    expect(firstCommand).toMatchObject({
      commandType: "VIDEO_WARMUP_STOP",
      idempotencyKey: `video-warmup-stop:${stopBatchId}:${deviceCode}`,
      payloadJson: {
        featureKey: "video_warmup",
        batchId: stopBatchId,
        reason: "USER_REQUESTED"
      }
    });

    const rows = await db.select({ id: mobileCommands.id })
      .from(mobileCommands)
      .where(and(
        eq(mobileCommands.deviceId, deviceId),
        eq(mobileCommands.idempotencyKey, `video-warmup-stop:${stopBatchId}:${deviceCode}`)
      ));
    expect(rows).toHaveLength(1);
  });
});

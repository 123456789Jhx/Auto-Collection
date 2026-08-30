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

function adminGet(path: string) {
  return app.request(path, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
}

function mobilePost(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-device-token": deviceToken },
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

  test("filters command progress by batch without the global recent-command window", async () => {
    const filteredBatchId = crypto.randomUUID();
    const created = await adminRequest("/api/v1/admin/mobile-commands", {
      deviceId: deviceCode,
      commandType: "ACCOUNT_WARMUP_RUN",
      payload: {
        featureKey: "live_comment_entry",
        batchId: filteredBatchId,
        config: { targetKeyword: "筛选测试", minViewerCount: 300 }
      }
    });
    expect(created.status).toBe(201);

    const response = await adminGet(`/api/v1/admin/mobile-commands?batchId=${filteredBatchId}`);
    expect(response.status).toBe(200);
    const commands = await response.json();
    expect(commands).toHaveLength(1);
    expect(commands[0].payloadJson.batchId).toBe(filteredBatchId);
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

  test("records an APK manual stop against the bound running command", async () => {
    const manualBatchId = crypto.randomUUID();
    const start = await adminRequest("/api/v1/admin/mobile-commands", {
      deviceId: deviceCode,
      commandType: "ACCOUNT_WARMUP_RUN",
      payload: { featureKey: "video_warmup", batchId: manualBatchId, config: { targetKeyword: "手动停止测试" } }
    });
    expect(start.status).toBe(201);
    const created = await start.json();
    await db.update(mobileCommands).set({ status: "RUNNING" }).where(eq(mobileCommands.id, created.id));

    const response = await mobilePost("/api/v1/mobile/commands/manual-stop", {
      deviceId: deviceCode,
      commandId: created.id,
      batchId: manualBatchId,
      reason: "LOCAL_STOP_BUTTON"
    });
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ status: "STOPPED", success: true, stoppedCount: 1, taskId: created.id });
    expect(receipt.exitCommandId).toBeString();

    const [saved] = await db.select().from(mobileCommands).where(eq(mobileCommands.id, created.id));
    expect(saved).toMatchObject({ status: "DONE", resultJson: { status: "STOPPED", reason: "LOCAL_STOP_BUTTON" } });

    const [cleanup] = await db.select().from(mobileCommands).where(eq(mobileCommands.id, receipt.exitCommandId));
    expect(cleanup).toMatchObject({ commandType: "EXIT_AGENT_APP", status: "PENDING" });

    const repeated = await mobilePost("/api/v1/mobile/commands/manual-stop", {
      deviceId: deviceCode,
      commandId: created.id,
      batchId: manualBatchId,
      reason: "LOCAL_STOP_BUTTON"
    });
    expect(await repeated.json()).toMatchObject({ status: "STOPPED", success: false, stoppedCount: 0, message: "ACTIVE_TASK_NOT_FOUND_OR_TERMINAL" });
  });

  test("falls back to the active video warmup command when APK identity is missing", async () => {
    const fallbackBatchId = crypto.randomUUID();
    const start = await adminRequest("/api/v1/admin/mobile-commands", {
      deviceId: deviceCode,
      commandType: "ACCOUNT_WARMUP_RUN",
      payload: { featureKey: "video_warmup", batchId: fallbackBatchId, config: { targetKeyword: "缺少身份停止测试" } }
    });
    expect(start.status).toBe(201);
    const created = await start.json();
    await db.update(mobileCommands).set({ status: "RUNNING" }).where(eq(mobileCommands.id, created.id));

    const response = await mobilePost("/api/v1/mobile/commands/manual-stop", {
      deviceId: deviceCode,
      reason: "LOCAL_STOP_BUTTON"
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "STOPPED", success: true, stoppedCount: 1, taskId: created.id });

    const [saved] = await db.select().from(mobileCommands).where(eq(mobileCommands.id, created.id));
    expect(saved).toMatchObject({ status: "DONE", resultJson: { status: "STOPPED", reason: "LOCAL_STOP_BUTTON" } });
  });

});

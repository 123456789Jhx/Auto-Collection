import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { agentUpdateEvents, agentVersions, collectorDevices } from "@pkg/db/schema";
import { and, eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../repositories/db";
import { BizScriptBuildError, bizScriptReleaseService } from "../services/biz-script-release.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
const version = `9.8.${Number.parseInt(suffix.slice(0, 4), 16)}`;
const deviceCode = `update-${suffix.slice(0, 12)}`;
const deviceToken = `${suffix}${suffix}`;
let adminToken = "";
let deviceId = "";

function adminRequest(path: string, method = "GET", body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

beforeAll(async () => {
  const response = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: "root" })
  });
  adminToken = (await response.json()).token;
});

afterAll(async () => {
  if (deviceId) {
    await db.delete(agentUpdateEvents).where(eq(agentUpdateEvents.deviceId, deviceId));
  }
  await db.delete(agentVersions).where(and(
    eq(agentVersions.channel, "biz-scripts"),
    eq(agentVersions.version, version)
  ));
  await db.delete(collectorDevices).where(eq(collectorDevices.deviceCode, deviceCode));
});

describe("business script release API", () => {
  test("build endpoint accepts only release options and maps concurrent builds", async () => {
    const originalBuild = bizScriptReleaseService.build;
    const received: unknown[] = [];
    try {
      bizScriptReleaseService.build = async (payload) => {
        received.push(payload);
        return { id: "built-version", version: "1.4.1", channel: "biz-scripts" };
      };
      const unsafeResponse = await adminRequest("/api/v1/admin/remote-scripts/releases/build", "POST", {
        releaseNote: "test",
        scriptPath: "C:/unsafe.ps1"
      });
      expect(unsafeResponse.status).toBe(400);
      expect(received).toHaveLength(0);

      const builtResponse = await adminRequest("/api/v1/admin/remote-scripts/releases/build", "POST", {
        releaseNote: "test",
        forceUpdate: false
      });
      expect(builtResponse.status).toBe(201);
      expect(await builtResponse.json()).toMatchObject({ id: "built-version", channel: "biz-scripts" });
      expect(received).toEqual([{ releaseNote: "test", forceUpdate: false }]);

      bizScriptReleaseService.build = async () => {
        throw new BizScriptBuildError("BUILD_IN_PROGRESS", "building");
      };
      const concurrentResponse = await adminRequest("/api/v1/admin/remote-scripts/releases/build", "POST", {});
      expect(concurrentResponse.status).toBe(409);
      expect((await concurrentResponse.json()).error.code).toBe("BUILD_IN_PROGRESS");
    } finally {
      bizScriptReleaseService.build = originalBuild;
    }
  });

  test("publishes idempotently and rejects changed metadata for the same version", async () => {
    const payload = {
      version,
      channel: "biz-scripts",
      packageUrl: `https://example.test/AgriVideoCollector-biz-scripts-${version}.zip`,
      sha256: "a".repeat(64),
      entryFile: "biz-script-manifest.json",
      releaseNote: "automated release"
    };

    const createdResponse = await adminRequest("/api/v1/admin/remote-scripts/releases", "POST", payload);
    const created = await createdResponse.json();
    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({ channel: "biz-scripts", version, idempotent: false });

    const repeatedResponse = await adminRequest("/api/v1/admin/remote-scripts/releases", "POST", payload);
    const repeated = await repeatedResponse.json();
    expect(repeatedResponse.status).toBe(200);
    expect(repeated).toMatchObject({ id: created.id, idempotent: true });

    const conflictResponse = await adminRequest("/api/v1/admin/remote-scripts/releases", "POST", {
      ...payload,
      sha256: "b".repeat(64)
    });
    const conflict = await conflictResponse.json();
    expect(conflictResponse.status).toBe(409);
    expect(conflict.error.code).toBe("VERSION_CONFLICT");

    for (const changed of [
      { forceUpdate: true },
      { minSupportedVersion: "1.2.0" },
      { releaseNote: "changed release note" }
    ]) {
      const semanticConflictResponse = await adminRequest(
        "/api/v1/admin/remote-scripts/releases",
        "POST",
        { ...payload, ...changed }
      );
      expect(semanticConflictResponse.status).toBe(409);
      expect((await semanticConflictResponse.json()).error.code).toBe("VERSION_CONFLICT");
    }

    const listResponse = await adminRequest("/api/v1/admin/remote-scripts/releases?channel=biz-scripts");
    const list = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(list.data.some((item: { id: string }) => item.id === created.id)).toBe(true);
  });

  test("exposes update audit events and latest status per device", async () => {
    const registerResponse = await app.request("/api/v1/mobile/device-token/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: deviceCode, deviceToken, platform: "android", appVersion: "1.0.75" })
    });
    expect(registerResponse.status).toBe(200);
    const device = await db.query.collectorDevices.findFirst({
      where: eq(collectorDevices.deviceCode, deviceCode)
    });
    deviceId = device?.id ?? "";

    const eventResponse = await app.request("/api/v1/mobile/agent-update-events", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Token": deviceToken },
      body: JSON.stringify({
        deviceId: deviceCode,
        fromVersion: "0.0.0",
        toVersion: version,
        eventType: "APPLIED",
        message: "business scripts applied",
        payload: { channel: "biz-scripts", fileCount: 3 }
      })
    });
    expect(eventResponse.status).toBe(200);

    const checkedResponse = await app.request("/api/v1/mobile/agent-update-events", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Token": deviceToken },
      body: JSON.stringify({
        deviceId: deviceCode,
        fromVersion: version,
        toVersion: version,
        eventType: "CHECKED",
        message: "already current",
        payload: { channel: "biz-scripts" }
      })
    });
    expect(checkedResponse.status).toBe(200);

    const auditResponse = await adminRequest(
      `/api/v1/admin/remote-scripts/update-events?channel=biz-scripts&deviceCode=${deviceCode}`
    );
    const audit = await auditResponse.json();
    expect(auditResponse.status).toBe(200);
    expect(audit.data[0]).toMatchObject({ deviceCode, toVersion: version, eventType: "CHECKED" });
    expect(audit.data[1]).toMatchObject({ deviceCode, toVersion: version, eventType: "APPLIED" });

    const statusResponse = await adminRequest(
      "/api/v1/admin/remote-scripts/device-update-status?channel=biz-scripts"
    );
    const status = await statusResponse.json();
    expect(statusResponse.status).toBe(200);
    expect(status.data.find((item: { deviceCode: string }) => item.deviceCode === deviceCode)).toMatchObject({
      currentVersion: version,
      deviceCode,
      updateStatus: "CHECKED",
      isCurrent: true
    });
    expect(status.summary.applied).toBeGreaterThanOrEqual(1);
  });
});

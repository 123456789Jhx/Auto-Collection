import { describe, expect, test } from "bun:test";
import { app } from "../app";

async function adminToken() {
  const response = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: "root" })
  });
  return String((await response.json()).token);
}

describe("comment action timing routes", () => {
  test("validates the single-device update payload before database access", async () => {
    const token = await adminToken();
    const response = await app.request("/api/v1/admin/devices/not-present/comment-action-timing", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timing: { schemaVersion: 1, actions: { unknown: { beforeMs: [0, 1] } } } })
    });
    expect(response.status).toBe(400);
  });

  test("validates copy targets before database access", async () => {
    const token = await adminToken();
    const response = await app.request("/api/v1/admin/device-profile-overrides/copy", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sourceDeviceCode: "same", platform: "douyin", expectedUpdatedAt: null, targets: [{ deviceCode: "same", expectedUpdatedAt: null }] })
    });
    expect(response.status).toBe(400);
  });

  test("requires a revision when the legacy task-config route writes device profile", async () => {
    const token = await adminToken();
    const response = await app.request("/api/v1/admin/devices/not-present/task-config", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceProfile: {} })
    });
    expect(response.status).toBe(400);
  });
});

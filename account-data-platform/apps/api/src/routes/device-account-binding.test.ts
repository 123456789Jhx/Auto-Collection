import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices } from "@pkg/db/schema";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../repositories/db";

const suffix = crypto.randomUUID().replaceAll("-", "");
const deviceCode = `node10-device-${suffix.slice(0, 12)}`;
const deviceToken = `${suffix}${suffix}`;
let adminToken = "";

function adminRequest(body: unknown) {
  return app.request(`/api/v1/admin/devices/${deviceCode}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

beforeAll(async () => {
  const loginResponse = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: "root" })
  });
  adminToken = (await loginResponse.json()).token;

  const registerResponse = await app.request("/api/v1/mobile/device-token/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: deviceCode,
      deviceToken,
      platform: "douyin",
      appVersion: "node10-test"
    })
  });
  expect(registerResponse.status).toBe(200);
});

afterAll(async () => {
  await db.delete(collectorDevices).where(eq(collectorDevices.deviceCode, deviceCode));
});

describe("device account binding", () => {
  test("validates, stores and returns the binding to the device", async () => {
    const invalidResponse = await adminRequest({
      accountProfile: {
        douyinAccountId: "test-001",
        douyinAccountName: 123,
        wechatChannelsName: ""
      }
    });
    expect(invalidResponse.status).toBe(400);

    const accountProfile = {
      douyinAccountId: "test-001",
      douyinAccountName: "测试号001",
      wechatChannelsName: ""
    };
    const updateResponse = await adminRequest({ accountProfile });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()).accountProfile).toEqual(accountProfile);

    const currentTaskResponse = await app.request(
      `/api/v1/mobile/tasks/current?deviceId=${deviceCode}&platform=douyin`,
      { headers: { "X-Device-Token": deviceToken } }
    );
    expect(currentTaskResponse.status).toBe(200);
    expect((await currentTaskResponse.json()).accountProfile).toEqual(accountProfile);
  });
});

import { afterAll, beforeAll, expect, test } from "bun:test";
import { collectorDevices, liveRoomCaptures, liveRoomProfiles, mobileCommands } from "@pkg/db/schema";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { config } from "../config";
import { db } from "../repositories/db";

const batchId = crypto.randomUUID();
let deviceId = "";
let commandId = "";
let captureId = "";
let token = "";

beforeAll(async () => {
  const login = await app.request("/api/v1/admin/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: config.adminUsername, password: config.adminPassword })
  });
  token = (await login.json()).token;
  const [device] = await db.insert(collectorDevices).values({
    deviceCode: `profile-export-${batchId}`, createdBy: "test", updatedBy: "test"
  }).returning();
  deviceId = device.id;
  const [command] = await db.insert(mobileCommands).values({
    deviceId, commandType: "ACCOUNT_WARMUP_RUN", createdBy: "test", updatedBy: "test"
  }).returning();
  commandId = command.id;
  const [capture] = await db.insert(liveRoomCaptures).values({
    batchId, deviceId, commandId, roomKey: "capture:1", captureCompleted: true,
    rawComments: [{ commentText: "有没有大码" }], createdBy: "test", updatedBy: "test"
  }).returning();
  captureId = capture.id;
  await db.insert(liveRoomProfiles).values({
    captureId, status: "SUCCEEDED", model: "gpt-5.5", summary: "已保存的画像摘要",
    audienceFeatures: ["关注商品尺码"], interestNeeds: ["大码服装"],
    interactionTraits: ["主动提问"], evidenceComments: [{ text: "有没有大码", reason: "明确询问" }],
    createdBy: "test", updatedBy: "test"
  });
});

afterAll(async () => {
  if (captureId) await db.delete(liveRoomProfiles).where(eq(liveRoomProfiles.captureId, captureId));
  await db.delete(liveRoomCaptures).where(eq(liveRoomCaptures.batchId, batchId));
  if (commandId) await db.delete(mobileCommands).where(eq(mobileCommands.id, commandId));
  if (deviceId) await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
});

test("exports the saved profile repeatedly with a valid Chinese download filename", async () => {
  const getExport = () => app.request(`/api/v1/admin/live-room-captures/${captureId}/profile/markdown`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const first = await getExport();
  expect(first.status).toBe(200);
  expect(first.headers.get("content-type")).toContain("text/markdown");
  const disposition = first.headers.get("content-disposition") || "";
  expect(disposition).toMatch(/^attachment; filename\*=UTF-8''/);
  expect(decodeURIComponent(disposition.split("UTF-8''")[1])).toBe("capture:1-用户画像.md");
  const markdown = await first.text();
  expect(markdown).toContain("已保存的画像摘要");
  expect(markdown).toContain("有没有大码");
  const second = await getExport();
  expect(second.status).toBe(200);
  expect(await second.text()).toBe(markdown);
});

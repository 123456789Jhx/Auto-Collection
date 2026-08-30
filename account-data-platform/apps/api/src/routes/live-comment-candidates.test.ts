import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collectorDevices, liveCommentCandidates, mobileCommands } from "@pkg/db/schema";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { captureLiveCommentCandidates } from "../services/live-comment-candidate.service";
import { db } from "../repositories/db";

const suffix = crypto.randomUUID();
const batchId = crypto.randomUUID();
let adminToken = "";
let deviceId = "";
let commandId = "";

function adminRequest(path: string, method = "GET", body?: unknown) {
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${adminToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

beforeAll(async () => {
  const login = await app.request("/api/v1/admin/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: "root" })
  });
  adminToken = (await login.json()).token;
  const [device] = await db.insert(collectorDevices).values({
    deviceCode: `candidate-device-${suffix}`, deviceName: "候选测试设备", createdBy: "test", updatedBy: "test"
  }).returning({ id: collectorDevices.id });
  deviceId = device.id;
  const [command] = await db.insert(mobileCommands).values({
    deviceId, commandType: "ACCOUNT_WARMUP_RUN", payloadJson: { featureKey: "isolated_live_comment_entry", batchId },
    createdBy: "test", updatedBy: "test"
  }).returning({ id: mobileCommands.id });
  commandId = command.id;
  await captureLiveCommentCandidates({
    id: commandId, deviceId, payloadJson: { featureKey: "isolated_live_comment_entry", batchId },
    resultJson: { comments: [
      { commentText: "候选词一", roomKey: "room-1", pageIndex: 0, userName: "用户甲" },
      { commentText: "候选词二", roomKey: "room-1", pageIndex: 1, userName: "用户乙" }
    ] }
  });
});

afterAll(async () => {
  await db.delete(liveCommentCandidates).where(eq(liveCommentCandidates.batchId, batchId));
  await db.delete(mobileCommands).where(eq(mobileCommands.id, commandId));
  await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
});

describe("live comment candidate admin API", () => {
  test("lists candidates as pending and leaves unselected rows untouched", async () => {
    const response = await adminRequest(`/api/v1/admin/live-comment-candidates?batchId=${batchId}`);
    expect(response.status).toBe(200);
    const rows = await response.json();
    expect(rows).toHaveLength(2);
    expect(rows.every((row: { status: string }) => row.status === "PENDING")).toBe(true);
    expect(rows[0].sourcesJson[0]).toMatchObject({ roomKey: "room-1", pageIndex: 0, userName: "用户甲" });
  });

  test("imports only selected candidates and repeated confirmation is idempotent", async () => {
    const rows = await (await adminRequest(`/api/v1/admin/live-comment-candidates?batchId=${batchId}`)).json();
    const first = await adminRequest("/api/v1/admin/live-comment-candidates/confirm", "POST", { batchId, candidateIds: [rows[0].id] });
    expect(first.status).toBe(200);
    expect((await first.json()).importedCount).toBe(1);
    const second = await adminRequest("/api/v1/admin/live-comment-candidates/confirm", "POST", { batchId, candidateIds: [rows[0].id] });
    expect((await second.json()).importedCount).toBe(0);
    const remaining = await (await adminRequest(`/api/v1/admin/live-comment-candidates?batchId=${batchId}`)).json();
    expect(remaining.find((row: { commentText: string }) => row.commentText === "候选词二").status).toBe("PENDING");
  });
});

import { afterAll, beforeAll, expect, test } from "bun:test";
import { collectorDevices, liveRoomCaptures, liveRoomProfiles, mobileCommands } from "@pkg/db/schema";
import { eq, inArray } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";
import { createLiveRoomProfile, findLiveRoomProfile, updateLiveRoomProfile } from "./live-room-capture.repository";

const actor = `profile-claim-${crypto.randomUUID().slice(0, 8)}`;
const captureIds: string[] = [];
let deviceId = "";
let commandId = "";

beforeAll(async () => {
  const [device] = await db.insert(collectorDevices).values({
    tenantId: config.tenantId,
    deviceCode: actor,
    enabled: false,
    status: "offline",
    createdBy: actor,
    updatedBy: actor
  }).returning();
  deviceId = device!.id;
  const [command] = await db.insert(mobileCommands).values({
    tenantId: config.tenantId,
    deviceId,
    commandType: "ACCOUNT_WARMUP_RUN",
    payloadJson: {},
    status: "SUCCEEDED",
    issuedAt: new Date(),
    expiresAt: new Date(),
    createdBy: actor,
    updatedBy: actor
  }).returning();
  commandId = command!.id;
});

afterAll(async () => {
  if (captureIds.length) {
    await db.delete(liveRoomProfiles).where(inArray(liveRoomProfiles.captureId, captureIds));
    await db.delete(liveRoomCaptures).where(inArray(liveRoomCaptures.id, captureIds));
  }
  if (commandId) await db.delete(mobileCommands).where(eq(mobileCommands.id, commandId));
  if (deviceId) await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
});

async function newCapture() {
  const [capture] = await db.insert(liveRoomCaptures).values({
    tenantId: config.tenantId,
    deviceId,
    commandId,
    batchId: crypto.randomUUID(),
    roomKey: "capture:1",
    rawComments: [{ text: "fixture comment" }],
    createdBy: actor,
    updatedBy: actor
  }).returning();
  captureIds.push(capture!.id);
  return capture!.id;
}

function claim(captureId: string) {
  return createLiveRoomProfile({ captureId, status: "PENDING", provider: "OpenAI", model: "gpt-5.5" });
}

test("only one concurrent request claims a new profile", async () => {
  const captureId = await newCapture();
  const results = await Promise.all(Array.from({ length: 8 }, () => claim(captureId)));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await findLiveRoomProfile(captureId))?.status).toBe("PENDING");
});

test("a failed profile can be retried once and completed profiles cannot be claimed again", async () => {
  const captureId = await newCapture();
  const pending = await claim(captureId);
  await updateLiveRoomProfile(captureId, { status: "FAILED", errorMessage: "fixture failure" }, pending!.updatedAt);
  const results = await Promise.all(Array.from({ length: 8 }, () => claim(captureId)));
  const winner = results.find(Boolean)!;
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(winner.errorMessage).toBeNull();
  expect(winner.completedAt).toBeNull();
  const running = await updateLiveRoomProfile(captureId, { status: "RUNNING" }, winner.updatedAt);
  await updateLiveRoomProfile(captureId, { status: "SUCCEEDED", summary: "saved snapshot" }, running!.updatedAt);
  expect(await claim(captureId)).toBeUndefined();
  expect(await findLiveRoomProfile(captureId)).toMatchObject({ status: "SUCCEEDED", summary: "saved snapshot" });
});

test("unexpired pending and running requests retain ownership", async () => {
  const captureId = await newCapture();
  const pending = await claim(captureId);
  expect(await claim(captureId)).toBeUndefined();
  expect((await findLiveRoomProfile(captureId))?.updatedAt).toEqual(pending!.updatedAt);
  const running = await updateLiveRoomProfile(captureId, { status: "RUNNING" }, pending!.updatedAt);
  expect(running!.updatedAt.getTime()).toBeGreaterThan(pending!.updatedAt.getTime());
  expect(await claim(captureId)).toBeUndefined();
  expect(await findLiveRoomProfile(captureId)).toMatchObject({ status: "RUNNING", updatedAt: running!.updatedAt });
});

test.each(["PENDING", "RUNNING"])("expired %s requests become retryable on read", async (status) => {
  const captureId = await newCapture();
  await claim(captureId);
  await db.update(liveRoomProfiles).set({
    status,
    updatedAt: new Date(Date.now() - 301_000)
  }).where(eq(liveRoomProfiles.captureId, captureId));
  const failed = await findLiveRoomProfile(captureId);
  expect(failed?.status).toBe("FAILED");
  expect(failed?.errorMessage).toContain("超时");
  expect((await claim(captureId))?.status).toBe("PENDING");
});

test("late completion cannot overwrite a newer attempt after timeout recovery", async () => {
  const captureId = await newCapture();
  await claim(captureId);
  const [expired] = await db.update(liveRoomProfiles).set({
    status: "RUNNING",
    updatedAt: new Date(Date.now() - 301_000)
  }).where(eq(liveRoomProfiles.captureId, captureId)).returning();
  await findLiveRoomProfile(captureId);
  const retry = await claim(captureId);
  const running = await updateLiveRoomProfile(captureId, { status: "RUNNING" }, retry!.updatedAt);
  expect(await updateLiveRoomProfile(captureId, {
    status: "SUCCEEDED", summary: "obsolete result"
  }, expired!.updatedAt)).toBeNull();
  expect(await updateLiveRoomProfile(captureId, {
    status: "FAILED", errorMessage: "obsolete failure"
  }, retry!.updatedAt)).toBeNull();
  expect(await updateLiveRoomProfile(captureId, {
    status: "SUCCEEDED", summary: "current result"
  }, running!.updatedAt)).toMatchObject({ status: "SUCCEEDED", summary: "current result" });
});

test("two-argument updates remain supported and missing profiles return null", async () => {
  const captureId = await newCapture();
  expect(await findLiveRoomProfile(captureId)).toBeNull();
  expect(await updateLiveRoomProfile(captureId, { status: "FAILED" })).toBeNull();
  await claim(captureId);
  expect(await updateLiveRoomProfile(captureId, { status: "FAILED" })).toMatchObject({ status: "FAILED" });
});

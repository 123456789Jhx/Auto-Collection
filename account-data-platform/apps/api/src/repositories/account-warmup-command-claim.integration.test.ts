import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { collectorDevices, mobileCommands } from "@pkg/db/schema";
import { eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";
import { claimPendingCommandByDeviceId, createMobileCommand, listMobileCommands } from "./command.repository";

const suffix = crypto.randomUUID().replaceAll("-", "");
const deviceCode = `warmup-claim-${suffix.slice(0, 12)}`;
const batchId = crypto.randomUUID();
let deviceId = "";

function commandValues(commandType: "ACCOUNT_WARMUP_RUN" | "ACCOUNT_WARMUP_STOP", payloadJson: Record<string, unknown>) {
  return {
    tenantId: config.tenantId,
    deviceId,
    commandType,
    payloadJson,
    status: "PENDING" as const,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    createdBy: "warmup-claim-test",
    updatedBy: "warmup-claim-test"
  };
}

beforeAll(async () => {
  const [device] = await db.insert(collectorDevices).values({
    deviceCode,
    deviceToken: `${suffix}${suffix}`,
    enabled: true,
    status: "online",
    createdBy: "warmup-claim-test",
    updatedBy: "warmup-claim-test"
  }).returning();
  deviceId = device?.id ?? "";
  if (!deviceId) throw new Error("TEST_DEVICE_CREATE_FAILED");
});

beforeEach(async () => {
  await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
});

afterAll(async () => {
  await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, deviceId));
  await db.delete(collectorDevices).where(eq(collectorDevices.id, deviceId));
});

test("claims only the matching warmup stop while its run remains active", async () => {
  const run = await createMobileCommand(commandValues("ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId,
    config: { targetKeyword: "药材种植", minViewerCount: 300 }
  }));
  const claimedRun = await claimPendingCommandByDeviceId(deviceId, "AGENT");
  expect(claimedRun?.id).toBe(run.id);

  await createMobileCommand(commandValues("ACCOUNT_WARMUP_STOP", {
    batchId,
    targetCommandId: crypto.randomUUID()
  }));
  const matchingStop = await createMobileCommand(commandValues("ACCOUNT_WARMUP_STOP", {
    batchId,
    targetCommandId: run.id
  }));
  await createMobileCommand(commandValues("ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId: crypto.randomUUID(),
    config: { targetKeyword: "第二个任务", minViewerCount: 300 }
  }));

  const claimedStop = await claimPendingCommandByDeviceId(deviceId, "AGENT");
  expect(claimedStop?.id).toBe(matchingStop.id);
  expect(claimedStop?.commandType).toBe("ACCOUNT_WARMUP_STOP");
  expect(await claimPendingCommandByDeviceId(deviceId, "AGENT")).toBeNull();

  const batchCommands = await listMobileCommands(100, { batchId });
  expect(batchCommands).toHaveLength(3);
  expect((await listMobileCommands(100, { batchId, featureKey: "live_comment_entry" }))
    .filter((command) => command.commandType === "ACCOUNT_WARMUP_RUN")).toHaveLength(1);
});

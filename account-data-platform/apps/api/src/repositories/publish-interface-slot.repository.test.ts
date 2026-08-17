import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  collectorDevices,
  publishAccountBindings,
  publishRuns,
  publishSlotExecutions,
  remoteScriptConfigs
} from "@pkg/db/schema";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { ensureInterfacePublishDailySlots } from "./publish-interface-slot.repository";

const suffix = crypto.randomUUID().replaceAll("-", "");
const actor = `slot-restart-${suffix.slice(0, 8)}`;
const businessDate = "2099-08-06";
const ids = { config: "", device: "", binding: "", firstRun: "", secondRun: "" };

beforeAll(async () => {
  const [savedConfig] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: `slot-restart-${suffix}`,
    configPayload: { sourceMode: "external_pull" },
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: actor,
    updatedBy: actor
  }).returning();
  const [device] = await db.insert(collectorDevices).values({
    deviceCode: `slot-restart-${suffix.slice(0, 12)}`,
    enabled: true,
    status: "online",
    lastHeartbeatAt: new Date(),
    createdBy: actor,
    updatedBy: actor
  }).returning();
  const [binding] = await db.insert(publishAccountBindings).values({
    deviceCode: device.deviceCode,
    platform: "DOUYIN",
    accountName: `重启测试账号-${suffix.slice(0, 8)}`,
    accountNo: `douyin-${suffix}`,
    createdBy: actor,
    updatedBy: actor
  }).returning();
  const runs = await db.insert(publishRuns).values([
    {
      configId: savedConfig.id,
      status: "STOPPED",
      morningPublishTime: "09:00",
      afternoonPublishTime: "15:00",
      startedBy: actor,
      createdBy: actor,
      updatedBy: actor
    },
    {
      configId: savedConfig.id,
      status: "STOPPED",
      morningPublishTime: "09:00",
      afternoonPublishTime: "15:00",
      startedBy: actor,
      createdBy: actor,
      updatedBy: actor
    }
  ]).returning();
  Object.assign(ids, {
    config: savedConfig.id,
    device: device.id,
    binding: binding.id,
    firstRun: runs[0]!.id,
    secondRun: runs[1]!.id
  });
});

afterAll(async () => {
  if (ids.binding) {
    await db.delete(publishSlotExecutions).where(eq(publishSlotExecutions.bindingId, ids.binding));
  }
  if (ids.firstRun) await db.delete(publishRuns).where(eq(publishRuns.id, ids.firstRun));
  if (ids.secondRun) await db.delete(publishRuns).where(eq(publishRuns.id, ids.secondRun));
  if (ids.binding) await db.delete(publishAccountBindings).where(eq(publishAccountBindings.id, ids.binding));
  if (ids.config) await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, ids.config));
  if (ids.device) await db.delete(collectorDevices).where(eq(collectorDevices.id, ids.device));
});

describe("interface publish slot restart ownership", () => {
  test("a later run adopts an unfinished daily slot without resetting published history", async () => {
    const first = await ensureInterfacePublishDailySlots({
      runId: ids.firstRun,
      businessDate,
      bindings: [{ bindingId: ids.binding }]
    });
    const morning = first.find((row) => row.slot === "MORNING")!;
    const afternoon = first.find((row) => row.slot === "AFTERNOON")!;
    const retryAt = new Date("2099-08-06T07:10:00.000Z");
    await db.update(publishSlotExecutions).set({
      status: "PUBLISHED",
      publishedAt: new Date("2099-08-06T01:05:00.000Z")
    }).where(eq(publishSlotExecutions.id, morning.id));
    await db.update(publishSlotExecutions).set({
      status: "NO_MATERIAL",
      nextRetryAt: retryAt,
      attemptCount: 1
    }).where(eq(publishSlotExecutions.id, afternoon.id));

    await ensureInterfacePublishDailySlots({
      runId: ids.secondRun,
      businessDate,
      bindings: [{ bindingId: ids.binding }]
    });

    const rows = await db.select().from(publishSlotExecutions).where(and(
      eq(publishSlotExecutions.bindingId, ids.binding),
      eq(publishSlotExecutions.businessDate, businessDate)
    ));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.slot === "MORNING")).toMatchObject({
      runId: ids.firstRun,
      status: "PUBLISHED"
    });
    expect(rows.find((row) => row.slot === "AFTERNOON")).toMatchObject({
      runId: ids.secondRun,
      status: "NO_MATERIAL",
      nextRetryAt: retryAt,
      attemptCount: 1
    });
  });
});

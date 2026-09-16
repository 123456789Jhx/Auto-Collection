import { afterAll, describe, expect, test } from "bun:test";
import { collectionTasks, collectorDevices, deviceTaskConfigs, mobileCommands } from "@pkg/db/schema";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  CommentActionTimingConflictError,
  copyCommentActionTimingAtomic
} from "./comment-action-timing.repository";

const databaseUrl = process.env.DATABASE_URL ?? "";
const isolatedDatabase = databaseUrl.includes("/codex_comment_timing_");
const integrationEnabled = process.env.COMMENT_TIMING_INTEGRATION === "1" && isolatedDatabase;
const runIntegration = integrationEnabled ? test : test.skip;

afterAll(async () => {
  if (integrationEnabled) await db.$client.end({ timeout: 1 });
});

describe("comment action timing transaction repository", () => {
  runIntegration("copies a resolved snapshot atomically and keeps target profile fields", async () => {
    const [task] = await db.insert(collectionTasks).values({
      taskCode: "comment-timing-integration",
      name: "Comment timing integration",
      platform: "douyin",
      mode: "search",
      searchKeywords: ["test"],
      matchKeywords: ["test"]
    }).returning();
    const devices = await db.insert(collectorDevices).values([
      { deviceCode: "timing-source", deviceName: "source", platform: "douyin" },
      { deviceCode: "timing-target-a", deviceName: "target-a", platform: "douyin" },
      { deviceCode: "timing-target-b", deviceName: "target-b", platform: "douyin" }
    ]).returning();
    const byCode = new Map(devices.map((device) => [device.deviceCode, device]));
    const created = await db.insert(deviceTaskConfigs).values([
      {
        deviceId: byCode.get("timing-source")!.id,
        taskId: task.id,
        deviceProfile: {
          openDouyinWaitMs: [20_000, 20_000],
          commentActionTiming: {
            schemaVersion: 1,
            enabled: true,
            actions: { swipeComments: { afterMs: [900, 1200] } }
          }
        }
      },
      {
        deviceId: byCode.get("timing-target-a")!.id,
        taskId: task.id,
        deviceProfile: { openDouyinWaitMs: [5000, 5000], outputRoots: ["/keep-a"] }
      },
      {
        deviceId: byCode.get("timing-target-b")!.id,
        taskId: task.id,
        deviceProfile: { capture: { foregroundWaitMs: 800 } }
      }
    ]).returning();
    const configByDevice = new Map(created.map((item) => [item.deviceId, item]));
    const expected = (deviceCode: string) => configByDevice.get(byCode.get(deviceCode)!.id)!.updatedAt.toISOString();

    const copied = await copyCommentActionTimingAtomic({
      sourceDeviceCode: "timing-source",
      platform: "douyin",
      expectedUpdatedAt: expected("timing-source"),
      targets: [
        { deviceCode: "timing-target-a", expectedUpdatedAt: expected("timing-target-a") },
        { deviceCode: "timing-target-b", expectedUpdatedAt: expected("timing-target-b") }
      ],
      actor: "integration-test"
    });
    expect(copied.results.every((result) => result.ok)).toBe(true);

    const saved = await db.select().from(deviceTaskConfigs).where(inArray(deviceTaskConfigs.deviceId, [
      byCode.get("timing-target-a")!.id,
      byCode.get("timing-target-b")!.id
    ]));
    const targetA = saved.find((item) => item.deviceId === byCode.get("timing-target-a")!.id)!;
    const timing = targetA.deviceProfile?.commentActionTiming as { actions: Record<string, { afterMs: [number, number] }> };
    expect(targetA.deviceProfile?.outputRoots).toEqual(["/keep-a"]);
    expect(targetA.deviceProfile?.openDouyinWaitMs).toEqual([5000, 5000]);
    expect(Object.keys(timing.actions)).toHaveLength(17);
    expect(timing.actions.openDouyin?.afterMs).toEqual([20_000, 20_000]);
    expect(timing.actions.swipeComments?.afterMs).toEqual([900, 1200]);

    const beforeConflict = await db.select().from(deviceTaskConfigs).where(eq(deviceTaskConfigs.id, targetA.id));
    const commandCountBefore = (await db.select().from(mobileCommands)).length;
    let conflict: unknown;
    try {
      await copyCommentActionTimingAtomic({
        sourceDeviceCode: "timing-source",
        platform: "douyin",
        expectedUpdatedAt: expected("timing-source"),
        targets: [
          { deviceCode: "timing-target-a", expectedUpdatedAt: copied.results[0]!.updatedAt },
          { deviceCode: "timing-target-b", expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }
        ],
        actor: "integration-test"
      });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(CommentActionTimingConflictError);
    expect(await db.select().from(deviceTaskConfigs).where(eq(deviceTaskConfigs.id, targetA.id))).toEqual(beforeConflict);
    expect((await db.select().from(mobileCommands)).length).toBe(commandCountBefore);
  }, 30_000);
});

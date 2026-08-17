import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { publishScheduleRuns, remoteScriptConfigs } from "@pkg/db/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../repositories/db";
import {
  finishPublishScheduleRunFailure,
  finishPublishScheduleRunSuccess,
  startPublishScheduleRun
} from "./publish-schedule-run.service";

const suffix = crypto.randomUUID().replaceAll("-", "");
let configId = "";

async function requireStartedRun(slotAt: Date) {
  const result = await startPublishScheduleRun({ configId, slotAt });
  if (!result.acquired) throw new Error("PUBLISH_SCHEDULE_RUN_NOT_ACQUIRED");
  return result.run;
}

beforeAll(async () => {
  const [savedConfig] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: `schedule-run-lock-${suffix}`,
    configPayload: {},
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: "schedule-run-test",
    updatedBy: "schedule-run-test"
  }).returning();
  configId = savedConfig.id;
});

afterAll(async () => {
  await db.delete(publishScheduleRuns).where(eq(publishScheduleRuns.configId, configId));
  await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, configId));
});

describe("publish schedule run service", () => {
  test("atomically acquires a slot once and reports duplicate callers", async () => {
    const slotAt = new Date("2026-07-28T01:30:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 5 }, () => startPublishScheduleRun({ configId, slotAt }))
    );

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(results.filter((result) => !result.acquired)).toHaveLength(4);

    const rows = await db.select().from(publishScheduleRuns).where(and(
      eq(publishScheduleRuns.configId, configId),
      eq(publishScheduleRuns.slotAt, slotAt)
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "RUNNING", claimedCount: 0, dispatchedCount: 0, reportedCount: 0 });
  });

  test("finishes a claimed run successfully with dispatch statistics", async () => {
    const run = await requireStartedRun(new Date("2026-07-28T02:30:00.000Z"));
    const finished = await finishPublishScheduleRunSuccess(run.id, {
      claimedCount: 3,
      dispatchedCount: 2,
      reportedCount: 1
    });

    expect(finished).toMatchObject({
      id: run.id,
      status: "SUCCEEDED",
      claimedCount: 3,
      dispatchedCount: 2,
      reportedCount: 1,
      error: null
    });
    expect(finished.finishedAt).toBeInstanceOf(Date);
  });

  test("finishes a claimed run with failure statistics and error", async () => {
    const run = await requireStartedRun(new Date("2026-07-28T03:30:00.000Z"));
    const finished = await finishPublishScheduleRunFailure(run.id, {
      claimedCount: 2,
      dispatchedCount: 1,
      reportedCount: 0
    }, "external publish API unavailable");

    expect(finished).toMatchObject({
      id: run.id,
      status: "FAILED",
      claimedCount: 2,
      dispatchedCount: 1,
      reportedCount: 0,
      error: "external publish API unavailable"
    });
    expect(finished.finishedAt).toBeInstanceOf(Date);
  });
});

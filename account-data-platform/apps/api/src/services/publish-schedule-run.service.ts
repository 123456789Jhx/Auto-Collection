import { publishScheduleRuns } from "@pkg/db/schema";
import { and, eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../repositories/db";

type PublishScheduleRunRow = typeof publishScheduleRuns.$inferSelect;

type PublishScheduleRunCounts = {
  claimedCount: number;
  dispatchedCount: number;
  reportedCount: number;
};

export type StartPublishScheduleRunInput = {
  configId: string;
  slotAt: Date;
};

export type StartPublishScheduleRunResult =
  | { acquired: true; run: PublishScheduleRunRow }
  | { acquired: false };

function validateSlotAt(slotAt: Date) {
  if (Number.isNaN(slotAt.getTime())) throw new Error("PUBLISH_SCHEDULE_RUN_SLOT_INVALID");
}

function validateCounts(counts: PublishScheduleRunCounts) {
  for (const value of Object.values(counts)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("PUBLISH_SCHEDULE_RUN_COUNTS_INVALID");
    }
  }
}

export async function startPublishScheduleRun(
  input: StartPublishScheduleRunInput
): Promise<StartPublishScheduleRunResult> {
  validateSlotAt(input.slotAt);
  const [run] = await db
    .insert(publishScheduleRuns)
    .values({
      tenantId: config.tenantId,
      configId: input.configId,
      slotAt: input.slotAt,
      status: "RUNNING"
    })
    .onConflictDoNothing({
      target: [
        publishScheduleRuns.tenantId,
        publishScheduleRuns.configId,
        publishScheduleRuns.slotAt
      ]
    })
    .returning();

  return run ? { acquired: true, run } : { acquired: false };
}

async function finishPublishScheduleRun(
  runId: string,
  status: "SUCCEEDED" | "FAILED",
  counts: PublishScheduleRunCounts,
  error: string | null
) {
  validateCounts(counts);
  const [run] = await db
    .update(publishScheduleRuns)
    .set({
      status,
      claimedCount: counts.claimedCount,
      dispatchedCount: counts.dispatchedCount,
      reportedCount: counts.reportedCount,
      error,
      finishedAt: new Date(),
      updatedAt: new Date()
    })
    .where(and(
      eq(publishScheduleRuns.id, runId),
      eq(publishScheduleRuns.tenantId, config.tenantId),
      eq(publishScheduleRuns.status, "RUNNING")
    ))
    .returning();

  if (!run) throw new Error("PUBLISH_SCHEDULE_RUN_NOT_RUNNING");
  return run;
}

export async function finishPublishScheduleRunSuccess(
  runId: string,
  counts: PublishScheduleRunCounts
) {
  return finishPublishScheduleRun(runId, "SUCCEEDED", counts, null);
}

export async function finishPublishScheduleRunFailure(
  runId: string,
  counts: PublishScheduleRunCounts,
  error: string
) {
  if (!error.trim()) throw new Error("PUBLISH_SCHEDULE_RUN_ERROR_REQUIRED");
  return finishPublishScheduleRun(runId, "FAILED", counts, error);
}

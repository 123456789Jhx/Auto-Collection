import { publishRunBindings, publishRuns, publishSlotExecutions } from "@pkg/db/schema";
import type { InterfacePublishRunConfig, InterfacePublishRunStatus, InterfacePublishSlot } from "@pkg/types";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { config as appConfig } from "../config";
import { db } from "../repositories/db";
import { publishInterfaceReservationService } from "./publish-interface-reservation.service";
import { publishInterfaceSlotService } from "./publish-interface-slot.service";
import { publishInterfaceStopService } from "./publish-interface-stop.service";
import { resolveBusinessClock, resolveDueSlots } from "./publish-interface-time.service";
import { startPublishStatusOutboxWorker } from "./publish-status-outbox.service";

export type RecoverableInterfacePublishRun = {
  id: string;
  status: InterfacePublishRunStatus;
  config: InterfacePublishRunConfig;
};

type RecoverySchedule = ReturnType<typeof classifyInterfaceRecoverySchedule>;

type RecoveryDependencies = {
  now?: () => Date;
  listRuns?: () => Promise<RecoverableInterfacePublishRun[]>;
  recoverReservations?: (runId: string, actor: string) => Promise<unknown>;
  recoverSchedule?: (
    runId: string,
    config: InterfacePublishRunConfig,
    schedule: RecoverySchedule,
    now: Date,
    actor: string
  ) => Promise<unknown>;
  triggerTick?: (runId: string) => Promise<unknown>;
  reconcileStop?: (runId: string, actor: string) => Promise<unknown>;
  startOutbox?: () => unknown;
};

export function classifyInterfaceRecoverySchedule(config: InterfacePublishRunConfig, now: Date) {
  const clock = resolveBusinessClock(now, config.timezone);
  const triggerSlots = resolveDueSlots(config, now);
  const expireSlots: InterfacePublishSlot[] = [];
  if (clock.minuteOfDay >= 12 * 60 && !triggerSlots.includes("MORNING")) {
    expireSlots.push("MORNING");
  }
  return { businessDate: clock.businessDate, triggerSlots, expireSlots };
}

async function listDatabaseRuns(): Promise<RecoverableInterfacePublishRun[]> {
  const rows = await db.select().from(publishRuns).where(and(
    eq(publishRuns.tenantId, appConfig.tenantId),
    inArray(publishRuns.status, ["SCHEDULED", "RUNNING", "STOPPING"]),
    isNull(publishRuns.deletedAt)
  ));
  return rows.map((row) => ({
    id: row.id,
    status: row.status as InterfacePublishRunStatus,
    config: {
      configId: row.configId,
      morningPublishTime: row.morningPublishTime,
      afternoonPublishTime: row.afternoonPublishTime,
      maxConcurrentPublishing: row.maxConcurrentPublishing,
      noMaterialRetryMinutes: row.noMaterialRetryMinutes,
      timezone: row.timezone as "Asia/Shanghai",
      platform: "DOUYIN"
    }
  }));
}

async function recoverDatabaseSchedule(
  runId: string,
  config: InterfacePublishRunConfig,
  schedule: RecoverySchedule,
  now: Date,
  actor: string
) {
  const bindings = await db.select({ bindingId: publishRunBindings.bindingId })
    .from(publishRunBindings)
    .where(and(
      eq(publishRunBindings.tenantId, appConfig.tenantId),
      eq(publishRunBindings.runId, runId),
      eq(publishRunBindings.skippedForRun, false),
      isNull(publishRunBindings.deletedAt)
    ));
  const bindingIds = bindings.map((binding) => binding.bindingId);
  await publishInterfaceSlotService.ensureDailySlots({
    runId,
    businessDate: schedule.businessDate,
    bindings
  });
  await publishInterfaceSlotService.activateDueSlots(config, bindingIds, now);
  for (const slot of schedule.expireSlots) {
    await publishInterfaceSlotService.expireWindowSlots(bindingIds, slot, schedule.businessDate, now);
  }
  await db.update(publishSlotExecutions).set({
    status: "WINDOW_EXPIRED",
    updatedAt: now,
    updatedBy: actor
  }).where(and(
    eq(publishSlotExecutions.tenantId, appConfig.tenantId),
    eq(publishSlotExecutions.runId, runId),
    lt(publishSlotExecutions.businessDate, schedule.businessDate),
    inArray(publishSlotExecutions.status, ["WAITING", "ELIGIBLE", "NO_MATERIAL", "DEVICE_UNAVAILABLE", "FAILED"]),
    isNull(publishSlotExecutions.deletedAt)
  ));
}

export function createPublishInterfaceRecoveryService(dependencies: RecoveryDependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const listRuns = dependencies.listRuns ?? listDatabaseRuns;
  const recoverReservations = dependencies.recoverReservations
    ?? ((runId, actor) => publishInterfaceReservationService.reconcile(runId, actor));
  const recoverSchedule = dependencies.recoverSchedule ?? recoverDatabaseSchedule;
  const triggerTick = dependencies.triggerTick ?? (async () => undefined);
  const reconcileStop = dependencies.reconcileStop
    ?? ((runId, actor) => publishInterfaceStopService.reconcile(runId, actor));
  const startOutbox = dependencies.startOutbox ?? startPublishStatusOutboxWorker;

  return {
    async recover(actor: string) {
      startOutbox();
      const currentTime = now();
      let recoveredRuns = 0;
      for (const run of await listRuns()) {
        if (!(["SCHEDULED", "RUNNING", "STOPPING"] as string[]).includes(run.status)) continue;
        recoveredRuns += 1;
        if (run.status === "STOPPING") {
          await reconcileStop(run.id, actor);
          continue;
        }
        await recoverReservations(run.id, actor);
        const schedule = classifyInterfaceRecoverySchedule(run.config, currentTime);
        await recoverSchedule(run.id, run.config, schedule, currentTime, actor);
        if (schedule.triggerSlots.length) await triggerTick(run.id);
      }
      return { recoveredRuns };
    }
  };
}

export const publishInterfaceRecoveryService = createPublishInterfaceRecoveryService();

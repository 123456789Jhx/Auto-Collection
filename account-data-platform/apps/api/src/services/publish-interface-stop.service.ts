import { mobileCommands, publishRuns, publishTasks } from "@pkg/db/schema";
import type { InterfacePublishLocalResult, InterfacePublishRunStatus } from "@pkg/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../repositories/db";
import { publishInterfaceReleaseService } from "./publish-interface-release.service";
import { publishInterfaceReservationService } from "./publish-interface-reservation.service";
import { publishInterfaceResultService } from "./publish-interface-result.service";
import { publishInterfaceRunService } from "./publish-interface-run.service";

const STOP_TIMEOUT_MS = 15 * 60 * 1000;

export type PublishInterfaceStopTask = {
  publishTaskId: string;
  taskStatus?: string;
  commandFetchedAt: Date | null;
  sideEffectStartedAt: Date | null;
  localResultStatus: InterfacePublishLocalResult | null;
  reportStatus: string;
};

type StopDependencies = {
  now?: () => Date;
  getRunStatus?: (runId: string) => Promise<InterfacePublishRunStatus | null>;
  listInFlight?: (runId: string) => Promise<PublishInterfaceStopTask[]>;
  releaseBeforeSideEffect?: typeof publishInterfaceReleaseService.releaseBeforeSideEffect;
  markTimedOut?: typeof publishInterfaceResultService.markTimedOut;
  countBlocking?: (runId: string) => Promise<number>;
  markStopped?: (runId: string, actor: string) => Promise<unknown>;
  releaseReservations?: (runId: string, actor: string) => Promise<unknown>;
};

export function assertInterfacePublishRunAcceptsWork(status: InterfacePublishRunStatus) {
  if (status !== "SCHEDULED" && status !== "RUNNING") {
    throw new Error("INTERFACE_PUBLISH_RUN_NOT_ACCEPTING_WORK");
  }
}

async function getDatabaseRunStatus(runId: string) {
  const [run] = await db.select({ status: publishRuns.status }).from(publishRuns).where(and(
    eq(publishRuns.tenantId, config.tenantId),
    eq(publishRuns.id, runId),
    isNull(publishRuns.deletedAt)
  )).limit(1);
  return (run?.status as InterfacePublishRunStatus | undefined) ?? null;
}

async function listDatabaseInFlight(runId: string): Promise<PublishInterfaceStopTask[]> {
  const rows = await db.select({
    publishTaskId: publishTasks.id,
    taskStatus: publishTasks.status,
    commandFetchedAt: sql<Date | null>`(
      select max(${mobileCommands.fetchedAt}) from ${mobileCommands}
      where ${mobileCommands.tenantId} = ${config.tenantId}
        and ${mobileCommands.idempotencyKey} = ${publishTasks.id}::text || ':' || ${publishTasks.matchedDeviceId}::text
        and ${mobileCommands.deletedAt} is null
    )`,
    sideEffectStartedAt: publishTasks.sideEffectStartedAt,
    localResultStatus: publishTasks.localResultStatus,
    reportStatus: publishTasks.reportStatus
  }).from(publishTasks).where(and(
    eq(publishTasks.tenantId, config.tenantId),
    eq(publishTasks.interfaceRunId, runId),
    isNull(publishTasks.localResultStatus),
    isNull(publishTasks.deletedAt)
  ));
  return rows.map((row) => ({
    ...row,
    localResultStatus: row.localResultStatus as InterfacePublishLocalResult | null
  }));
}

async function countDatabaseBlocking(runId: string) {
  const tasks = await listDatabaseInFlight(runId);
  return tasks.filter((task) => !(
    task.taskStatus === "RELEASE_PENDING"
    && ["REPORTED", "MANUAL_REVIEW"].includes(task.reportStatus)
  )).length;
}

export function createPublishInterfaceStopService(dependencies: StopDependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const getRunStatus = dependencies.getRunStatus ?? getDatabaseRunStatus;
  const listInFlight = dependencies.listInFlight ?? listDatabaseInFlight;
  const releaseBeforeSideEffect = dependencies.releaseBeforeSideEffect
    ?? publishInterfaceReleaseService.releaseBeforeSideEffect;
  const markTimedOut = dependencies.markTimedOut ?? publishInterfaceResultService.markTimedOut;
  const countBlocking = dependencies.countBlocking ?? countDatabaseBlocking;
  const markStopped = dependencies.markStopped
    ?? ((runId, actor) => publishInterfaceRunService.markStopped(runId, actor));
  const releaseReservations = dependencies.releaseReservations
    ?? ((runId, actor) => publishInterfaceReservationService.releaseAll(runId, actor));

  return {
    async reconcile(runId: string, actor: string) {
      const status = await getRunStatus(runId);
      if (status !== "STOPPING") throw new Error("INTERFACE_PUBLISH_RUN_NOT_STOPPING");
      const currentTime = now();
      const summary = { releaseQueued: 0, waitingForPhone: 0, unknown: 0 };
      for (const task of await listInFlight(runId)) {
        if (task.localResultStatus) continue;
        if (!task.commandFetchedAt && !task.sideEffectStartedAt) {
          if (task.taskStatus !== "RELEASE_PENDING") {
            await releaseBeforeSideEffect({
              publishTaskId: task.publishTaskId,
              reason: "接口发布总任务已停止，手机动作尚未开始",
              actor
            });
            summary.releaseQueued += 1;
          }
          continue;
        }
        const timeoutStart = task.commandFetchedAt ?? task.sideEffectStartedAt!;
        if (currentTime.getTime() - timeoutStart.getTime() >= STOP_TIMEOUT_MS) {
          const result = await markTimedOut(task.publishTaskId, actor);
          if ("localResultStatus" in result && result.localResultStatus === "RESULT_UNKNOWN") {
            summary.unknown += 1;
          }
        } else {
          summary.waitingForPhone += 1;
        }
      }
      if (await countBlocking(runId)) return { status: "STOPPING" as const, ...summary };
      await markStopped(runId, actor);
      await releaseReservations(runId, actor);
      return { status: "STOPPED" as const, ...summary };
    }
  };
}

export const publishInterfaceStopService = createPublishInterfaceStopService();

import { publishRunBindings, publishSlotExecutions } from "@pkg/db/schema";
import type {
  InterfacePublishReservationStatus,
  InterfacePublishSlotStatus
} from "@pkg/types";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "../repositories/db";
import type { PublishInterfaceRunRow } from "../repositories/publish-interface-run.repository";
import { getRemoteScriptConfig } from "./remote-script.service";
import { publishClientOnlyConfigSchema, publishVideoConfigSchema } from "./publish-config";
import { publishInterfaceClaimService } from "./publish-interface-claim.service";
import { publishInterfaceDispatchService } from "./publish-interface-dispatch.service";
import { publishInterfaceRecoveryService } from "./publish-interface-recovery.service";
import {
  createPublishInterfaceSchedulerCore,
  type PublishInterfaceSchedulerCandidate
} from "./publish-interface-scheduler-core";
import { publishInterfaceRunService } from "./publish-interface-run.service";

const INTERFACE_WORKER_INTERVAL_MS = 30_000;
const WORKER_ACTOR = "publish-interface-worker";
const DEFAULT_ALLOWED_MEDIA_HOSTS = [
  "jwai.086yx.com",
  "aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com",
  "media-auto.oss-cn-wuhan-lr.aliyuncs.com"
] as const;

type WorkerRun = PublishInterfaceRunRow;

type WorkerDependencies = {
  recoverActiveRuns?: (actor: string) => Promise<unknown>;
  getCurrentRun?: () => Promise<WorkerRun | null>;
  markRunning?: (runId: string, actor: string) => Promise<WorkerRun>;
  runSchedulerTick?: (
    run: WorkerRun,
    now: Date,
    actor: string
  ) => Promise<unknown>;
  now?: () => Date;
};

type DatabaseCandidate = PublishInterfaceSchedulerCandidate & {
  publishTaskId: string | null;
};

function allowedMediaHosts() {
  const configured = (process.env.PUBLISH_INTERFACE_MEDIA_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_MEDIA_HOSTS, ...configured])];
}

async function activePublishingCount(runId: string) {
  const [row] = await db.select({ value: count() }).from(publishSlotExecutions).where(and(
    eq(publishSlotExecutions.tenantId, config.tenantId),
    eq(publishSlotExecutions.runId, runId),
    eq(publishSlotExecutions.status, "DISPATCHED"),
    isNull(publishSlotExecutions.deletedAt)
  ));
  const [publishing] = await db.select({ value: count() }).from(publishSlotExecutions).where(and(
    eq(publishSlotExecutions.tenantId, config.tenantId),
    eq(publishSlotExecutions.runId, runId),
    eq(publishSlotExecutions.status, "PUBLISHING"),
    isNull(publishSlotExecutions.deletedAt)
  ));
  return Number(row?.value ?? 0) + Number(publishing?.value ?? 0);
}

async function listDatabaseCandidates(runId: string): Promise<DatabaseCandidate[]> {
  const rows = await db.select({
    slotExecutionId: publishSlotExecutions.id,
    bindingId: publishSlotExecutions.bindingId,
    accountName: publishRunBindings.accountName,
    externalAccountKey: publishRunBindings.externalAccountKey,
    slot: publishSlotExecutions.slot,
    status: publishSlotExecutions.status,
    reservationStatus: publishRunBindings.reservationStatus,
    nextRetryAt: publishSlotExecutions.nextRetryAt,
    attemptCount: publishSlotExecutions.attemptCount,
    publishTaskId: publishSlotExecutions.publishTaskId
  }).from(publishSlotExecutions).innerJoin(publishRunBindings, and(
    eq(publishRunBindings.tenantId, config.tenantId),
    eq(publishRunBindings.runId, publishSlotExecutions.runId),
    eq(publishRunBindings.bindingId, publishSlotExecutions.bindingId),
    isNull(publishRunBindings.deletedAt)
  )).where(and(
    eq(publishSlotExecutions.tenantId, config.tenantId),
    eq(publishSlotExecutions.runId, runId),
    eq(publishRunBindings.skippedForRun, false),
    isNull(publishSlotExecutions.publishTaskId),
    isNull(publishSlotExecutions.deletedAt)
  )).orderBy(asc(publishRunBindings.createdAt), asc(publishSlotExecutions.createdAt));

  return rows.map((row, stableOrder) => ({
    slotExecutionId: row.slotExecutionId,
    bindingId: row.bindingId,
    accountName: row.accountName,
    externalAccountKey: row.externalAccountKey,
    priority: row.slot === "MORNING" ? 0 : 1,
    attemptCount: row.attemptCount,
    stableOrder,
    status: row.status as InterfacePublishSlotStatus,
    reservationStatus: row.reservationStatus as InterfacePublishReservationStatus,
    nextRetryAt: row.nextRetryAt,
    publishTaskId: row.publishTaskId
  }));
}

async function runDatabaseSchedulerTick(run: WorkerRun, now: Date, actor: string) {
  const savedConfig = await getRemoteScriptConfig(run.configId);
  const publishConfig = publishVideoConfigSchema.parse(savedConfig.configPayload);
  if (savedConfig.status !== "ENABLED" || publishConfig.sourceMode !== "external_pull") {
    throw new Error("PUBLISH_CONFIG_NOT_ENABLED");
  }
  const clientConfig = publishClientOnlyConfigSchema.parse(savedConfig.configPayload);
  const hosts = allowedMediaHosts();
  const scheduler = createPublishInterfaceSchedulerCore({
    getActivePublishingCount: activePublishingCount,
    listCandidates: (runId) => listDatabaseCandidates(runId),
    executeCandidate: async (candidate) => {
      const claim = await publishInterfaceClaimService.claimOne({
        runId: run.id,
        configId: run.configId,
        slotExecutionId: candidate.slotExecutionId,
        accountName: candidate.accountName,
        externalAccountKey: candidate.externalAccountKey,
        clientConfig,
        actor
      });
      if (claim.kind !== "CLAIMED") return claim;
      await publishInterfaceDispatchService.dispatch({
        publishTaskId: claim.publishTaskId,
        allowedHosts: hosts,
        commandConfig: publishConfig,
        actor
      });
      return { kind: "DISPATCHED" as const };
    }
  });
  return scheduler.tick({
    runId: run.id,
    now,
    maxConcurrentPublishing: run.maxConcurrentPublishing
  });
}

export function createPublishInterfaceWorker(dependencies: WorkerDependencies = {}) {
  const recoverActiveRuns = dependencies.recoverActiveRuns
    ?? ((actor) => publishInterfaceRecoveryService.recover(actor));
  const getCurrentRun = dependencies.getCurrentRun
    ?? (() => publishInterfaceRunService.getCurrent());
  const markRunning = dependencies.markRunning
    ?? ((runId, actor) => publishInterfaceRunService.markRunning(runId, actor));
  const runSchedulerTick = dependencies.runSchedulerTick ?? runDatabaseSchedulerTick;
  const now = dependencies.now ?? (() => new Date());
  let tickInProgress = false;

  return {
    async tick(at = now()) {
      if (tickInProgress) return { outcome: "SKIPPED_REENTRANT" as const };
      tickInProgress = true;
      try {
        await recoverActiveRuns(WORKER_ACTOR);
        let run = await getCurrentRun();
        if (!run) return { outcome: "IDLE" as const };
        if (run.status === "STOPPING") {
          return { outcome: "STOPPING" as const, runId: run.id };
        }
        if (run.status !== "SCHEDULED" && run.status !== "RUNNING") {
          return { outcome: "INACTIVE" as const, runId: run.id, status: run.status };
        }
        if (run.status === "SCHEDULED") run = await markRunning(run.id, WORKER_ACTOR);
        const scheduler = await runSchedulerTick(run, at, WORKER_ACTOR);
        return { outcome: "PROCESSED" as const, runId: run.id, scheduler };
      } finally {
        tickInProgress = false;
      }
    }
  };
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
const publishInterfaceWorker = createPublishInterfaceWorker();

function runWorkerTick() {
  void publishInterfaceWorker.tick().catch((error) => {
    console.error("publish interface worker tick failed", error);
  });
}

export function startPublishInterfaceWorker() {
  if (workerTimer) return workerTimer;
  runWorkerTick();
  workerTimer = setInterval(runWorkerTick, INTERFACE_WORKER_INTERVAL_MS);
  workerTimer.unref?.();
  return workerTimer;
}

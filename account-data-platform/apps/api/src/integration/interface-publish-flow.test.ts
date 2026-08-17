import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  collectorDevices,
  mobileCommands,
  publishAccountBindings,
  publishRunBindings,
  publishRuns,
  publishSlotExecutions,
  publishStatusOutbox,
  publishTasks,
  remoteScriptConfigs
} from "@pkg/db/schema";
import type { ClaimedWecomPublishTask } from "@pkg/types";
import { eq } from "drizzle-orm";
import { db } from "../repositories/db";
import {
  createPublishInterfaceClaimService,
  type PublishInterfaceClaimRepository
} from "../services/publish-interface-claim.service";
import { publishInterfaceDispatchService } from "../services/publish-interface-dispatch.service";
import { publishInterfaceResultService } from "../services/publish-interface-result.service";
import {
  createPublishInterfaceSchedulerCore,
  type PublishInterfaceSchedulerCandidate
} from "../services/publish-interface-scheduler-core";
import {
  processNextPublishStatusOutbox,
  type PublishStatusOutboxEntry,
  type PublishStatusOutboxRepository
} from "../services/publish-status-outbox.service";
import { claimInterfacePublishTask, patchTaskStatus } from "../services/wecom-publish-client";
import { createInterfacePublishMockServer } from "../test-support/interface-publish-mock-server";

const suffix = crypto.randomUUID().replaceAll("-", "");
const actor = `node19-${suffix.slice(0, 8)}`;
const deviceCode = `node19-${suffix.slice(0, 12)}`;
const accountName = `节点19账号-${suffix.slice(0, 8)}`;
const tokenEnv = `NODE19_MOCK_TOKEN_${suffix}`;
const clientConfig = { externalBaseUrl: "https://mock.interface.test", externalTokenEnv: tokenEnv };
const ids = { config: "", device: "", binding: "", run: "", slot: "", task: "" };

function externalTask(taskId: string, name = accountName): ClaimedWecomPublishTask {
  return {
    taskId,
    accountName: name,
    title: "接口联调素材",
    description: "#接口联调",
    coverUrl: "https://media.example.test/cover.jpg",
    videoUrl: "https://media.example.test/video.mp4",
    platform: "抖音",
    status: "待发布"
  };
}

function mockFetch(server: ReturnType<typeof createInterfacePublishMockServer>) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    await server.app.request(input, init);
}

beforeAll(async () => {
  process.env[tokenEnv] = "node19-fake-token";
  const [config] = await db.insert(remoteScriptConfigs).values({
    scriptKey: "publish_video",
    configName: `node19-${suffix}`,
    configPayload: { sourceMode: "external_pull" },
    configHash: suffix.padEnd(64, "0").slice(0, 64),
    createdBy: actor,
    updatedBy: actor
  }).returning();
  const [device] = await db.insert(collectorDevices).values({
    deviceCode,
    deviceToken: `token-${suffix}`,
    enabled: true,
    status: "online",
    lastHeartbeatAt: new Date(),
    createdBy: actor,
    updatedBy: actor
  }).returning();
  const [binding] = await db.insert(publishAccountBindings).values({
    deviceCode,
    platform: "DOUYIN",
    accountName,
    accountNo: `douyin-${suffix}`,
    createdBy: actor,
    updatedBy: actor
  }).returning();
  const [run] = await db.insert(publishRuns).values({
    configId: config.id,
    status: "STOPPED",
    morningPublishTime: "09:00",
    afternoonPublishTime: "15:00",
    startedBy: actor,
    createdBy: actor,
    updatedBy: actor
  }).returning();
  await db.insert(publishRunBindings).values({
    runId: run.id,
    bindingId: binding.id,
    deviceId: device.id,
    deviceCode,
    accountName,
    accountNo: `douyin-${suffix}`,
    status: "VALID",
    reservationStatus: "RESERVED",
    createdBy: actor,
    updatedBy: actor
  });
  const [slot] = await db.insert(publishSlotExecutions).values({
    runId: run.id,
    bindingId: binding.id,
    businessDate: "2026-08-06",
    slot: "MORNING",
    status: "ELIGIBLE",
    createdBy: actor,
    updatedBy: actor
  }).returning();
  Object.assign(ids, {
    config: config.id,
    device: device.id,
    binding: binding.id,
    run: run.id,
    slot: slot.id
  });
});

afterAll(async () => {
  if (ids.task) await db.delete(publishStatusOutbox).where(eq(publishStatusOutbox.publishTaskId, ids.task));
  if (ids.device) await db.delete(mobileCommands).where(eq(mobileCommands.deviceId, ids.device));
  if (ids.run) {
    await db.update(publishSlotExecutions).set({ publishTaskId: null })
      .where(eq(publishSlotExecutions.runId, ids.run));
  }
  if (ids.config) await db.delete(publishTasks).where(eq(publishTasks.configId, ids.config));
  if (ids.run) await db.delete(publishSlotExecutions).where(eq(publishSlotExecutions.runId, ids.run));
  if (ids.run) await db.delete(publishRunBindings).where(eq(publishRunBindings.runId, ids.run));
  if (ids.run) await db.delete(publishRuns).where(eq(publishRuns.id, ids.run));
  if (ids.binding) await db.delete(publishAccountBindings).where(eq(publishAccountBindings.id, ids.binding));
  if (ids.config) await db.delete(remoteScriptConfigs).where(eq(remoteScriptConfigs.id, ids.config));
  if (ids.device) await db.delete(collectorDevices).where(eq(collectorDevices.id, ids.device));
  delete process.env[tokenEnv];
});

function memoryClaimRepository() {
  const unknown = new Map<string, string>();
  const noMaterial = new Map<string, Date>();
  const repository: PublishInterfaceClaimRepository = {
    findClaimResultUnknownAlertId: async (slotId) => unknown.get(slotId) ?? null,
    markNoMaterial: async (slotId, nextRetryAt) => { noMaterial.set(slotId, nextRetryAt); },
    markClaimResultUnknown: async (input) => {
      const alertId = `alert-${input.slotExecutionId}`;
      unknown.set(input.slotExecutionId, alertId);
      return { alertId };
    },
    saveClaimedTask: async (input) => ({
      publishTaskId: `local-${input.task.taskId}`,
      externalTaskId: input.task.taskId
    }),
    recordRejected: async () => undefined,
    resolveClaimResultUnknown: async () => true
  };
  return { repository, unknown, noMaterial };
}

function candidate(name: string, order: number): PublishInterfaceSchedulerCandidate {
  return {
    slotExecutionId: `slot-${name}`,
    bindingId: `binding-${name}`,
    accountName: name,
    priority: 0,
    attemptCount: 0,
    stableOrder: order,
    status: "ELIGIBLE",
    reservationStatus: "RESERVED",
    nextRetryAt: null
  };
}

describe("interface publish integrated flow", () => {
  test("persists one task and command, then stores phone success before outbox PATCH", async () => {
    const task = externalTask(`node19-task-${suffix}`);
    const server = createInterfacePublishMockServer({
      queues: { [accountName]: [task, task] },
      token: "node19-fake-token"
    });
    const service = createPublishInterfaceClaimService({
      claim: (config, name) => claimInterfacePublishTask(config, name, {
        fetch: mockFetch(server),
        logger: () => undefined
      })
    });
    const input = {
      runId: ids.run,
      configId: ids.config,
      slotExecutionId: ids.slot,
      accountName,
      clientConfig,
      actor
    };
    const first = await service.claimOne(input);
    const duplicate = await service.claimOne(input);
    expect(first).toMatchObject({ kind: "CLAIMED" });
    expect(duplicate).toMatchObject({ kind: "CLAIMED" });
    if (first.kind !== "CLAIMED") throw new Error("NODE19_CLAIM_FAILED");
    ids.task = first.publishTaskId;

    const commandConfig = {
      responseDelayMsMin: 10,
      responseDelayMsMax: 20,
      actionWaitMsMin: 30,
      actionWaitMsMax: 40,
      expectedTopicCount: 1,
      topicResolveTimeoutMinutes: 30
    };
    const dispatched = await publishInterfaceDispatchService.dispatch({
      publishTaskId: ids.task,
      allowedHosts: ["media.example.test"],
      commandConfig,
      actor
    });
    const redispatched = await publishInterfaceDispatchService.dispatch({
      publishTaskId: ids.task,
      allowedHosts: ["media.example.test"],
      commandConfig,
      actor
    });
    expect(dispatched.idempotent).toBeFalse();
    expect(redispatched).toMatchObject({ commandId: dispatched.commandId, idempotent: true });

    await publishInterfaceResultService.report(ids.task, {
      deviceId: deviceCode,
      status: "PUBLISHED",
      publishedUrl: "https://douyin.example.test/video/node19"
    }, actor);
    const [savedTask] = await db.select().from(publishTasks).where(eq(publishTasks.id, ids.task));
    const [savedSlot] = await db.select().from(publishSlotExecutions).where(eq(publishSlotExecutions.id, ids.slot));
    const [outbox] = await db.select().from(publishStatusOutbox).where(eq(publishStatusOutbox.publishTaskId, ids.task));
    expect(savedTask).toMatchObject({ localResultStatus: "PUBLISHED", status: "SUCCEEDED" });
    expect(savedSlot).toMatchObject({ status: "PUBLISHED" });
    expect(outbox).toMatchObject({ status: "REPORT_PENDING", targetStatus: "已发布" });
    expect(server.state.patches).toHaveLength(0);

    let current: PublishStatusOutboxEntry | null = {
      id: outbox.id,
      publishTaskId: ids.task,
      attempts: 1,
      targetStatus: "已发布",
      payload: { platform: "抖音", status: "已发布" }
    };
    const repository: PublishStatusOutboxRepository = {
      enqueue: async () => undefined,
      claimReady: async () => current,
      markReported: async () => { current = null; },
      markRetry: async (entry, error) => {
        await db.update(publishStatusOutbox).set({ status: "RETRY_WAIT", lastError: error })
          .where(eq(publishStatusOutbox.id, entry.id));
        current = { ...entry, attempts: entry.attempts + 1 };
      },
      markManualReview: async () => undefined
    };
    expect(await processNextPublishStatusOutbox(actor, {
      repository,
      buildPatch: async () => { throw new Error("mock PATCH unavailable"); }
    })).toMatchObject({ outcome: "RETRY_PENDING" });
    expect(await db.select().from(mobileCommands).where(eq(mobileCommands.deviceId, ids.device))).toHaveLength(1);
    expect(server.state.patches).toHaveLength(0);

    expect(await processNextPublishStatusOutbox(actor, {
      repository,
      buildPatch: async (entry) => ({ externalTaskId: task.taskId, clientConfig, payload: entry.payload }),
      patchStatus: (patch) => patchTaskStatus(patch.clientConfig, patch.externalTaskId, patch.payload, {
        fetch: mockFetch(server),
        logger: () => undefined
      })
    })).toMatchObject({ outcome: "REPORTED" });
    expect(server.state.patches).toHaveLength(1);
    expect(await db.select().from(mobileCommands).where(eq(mobileCommands.deviceId, ids.device))).toHaveLength(1);
  });

  test("fills N=3 with A/C/D while B waits ten minutes and claims stay serial", async () => {
    const names = ["A", "B", "C", "D"];
    const server = createInterfacePublishMockServer({
      queues: Object.fromEntries(names.map((name) => [name, name === "B" ? [] : [externalTask(`task-${name}`, name)]])),
      token: "node19-fake-token"
    });
    const memory = memoryClaimRepository();
    let activeClaims = 0;
    let peakClaims = 0;
    const service = createPublishInterfaceClaimService({
      repository: memory.repository,
      now: () => new Date("2026-08-06T01:00:00.000Z"),
      claim: async (config, name) => {
        activeClaims += 1;
        peakClaims = Math.max(peakClaims, activeClaims);
        try {
          return await claimInterfacePublishTask(config, name, { fetch: mockFetch(server), logger: () => undefined });
        } finally {
          activeClaims -= 1;
        }
      }
    });
    const scheduler = createPublishInterfaceSchedulerCore({
      getActivePublishingCount: async () => 0,
      listCandidates: async () => names.map(candidate),
      executeCandidate: async (item) => {
        const result = await service.claimOne({
          runId: "run-memory",
          configId: "config-memory",
          slotExecutionId: item.slotExecutionId,
          accountName: item.accountName,
          clientConfig,
          actor
        });
        return result.kind === "CLAIMED" ? { kind: "DISPATCHED" as const } : result;
      }
    });
    const result = await scheduler.tick({
      runId: "run-memory",
      now: new Date("2026-08-06T01:00:00.000Z"),
      maxConcurrentPublishing: 3
    });
    expect(result).toMatchObject({ dispatched: 3, noMaterial: 1, claimsAttempted: 4 });
    expect(new Set(server.state.claims)).toEqual(new Set(names));
    expect(peakClaims).toBe(1);
    expect(memory.noMaterial.get("slot-B")?.toISOString()).toBe("2026-08-06T01:10:00.000Z");
  });

  test("never exceeds N and never gives offline or busy bindings a claim", async () => {
    for (const limit of [1, 3, 50]) {
      const claims: string[] = [];
      const candidates = Array.from({ length: 60 }, (_, index) => candidate(String(index), index));
      candidates[0]!.reservationStatus = "WAITING_DEVICE";
      candidates[1]!.reservationStatus = "WAITING_DEVICE";
      const scheduler = createPublishInterfaceSchedulerCore({
        getActivePublishingCount: async () => 0,
        listCandidates: async () => candidates,
        executeCandidate: async (item) => {
          claims.push(item.bindingId);
          return { kind: "DISPATCHED" };
        }
      });
      const result = await scheduler.tick({
        runId: `run-${limit}`,
        now: new Date("2026-08-06T01:00:00.000Z"),
        maxConcurrentPublishing: limit
      });
      expect(result.dispatched).toBe(limit);
      expect(claims).toHaveLength(limit);
      expect(claims).not.toContain("binding-0");
      expect(claims).not.toContain("binding-1");
      candidates[0]!.reservationStatus = "RESERVED";
      expect(candidates[0]!.bindingId).toBe("binding-0");
    }
  });

  test("isolates an unknown claim result and never retries it automatically", async () => {
    const memory = memoryClaimRepository();
    let networkCalls = 0;
    const service = createPublishInterfaceClaimService({
      repository: memory.repository,
      claim: async () => {
        networkCalls += 1;
        return { kind: "RESULT_UNKNOWN", code: "EXTERNAL_REQUEST_RESULT_UNKNOWN" };
      }
    });
    const input = {
      runId: "run-unknown",
      configId: "config-unknown",
      slotExecutionId: "slot-unknown",
      accountName: "unknown-account",
      clientConfig,
      actor
    };
    expect(await service.claimOne(input)).toMatchObject({ kind: "CLAIM_RESULT_UNKNOWN" });
    expect(await service.claimOne(input)).toMatchObject({ kind: "CLAIM_RESULT_UNKNOWN" });
    expect(networkCalls).toBe(1);
  });
});

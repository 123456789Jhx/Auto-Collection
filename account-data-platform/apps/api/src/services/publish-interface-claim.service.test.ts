import { describe, expect, test } from "bun:test";
import type { ClaimedWecomPublishTask } from "@pkg/types";
import {
  createPublishInterfaceClaimService,
  type PublishInterfaceClaimRepository
} from "./publish-interface-claim.service";

const now = new Date("2026-08-06T01:00:00.000Z");
const request = {
  runId: "run-1",
  configId: "config-1",
  slotExecutionId: "slot-1",
  accountName: "开心幸福一家人",
  externalAccountKey: "query-41218954470",
  clientConfig: {
    externalBaseUrl: "https://external.example.test",
    externalTokenEnv: "PUBLISH_EXTERNAL_TOKEN"
  },
  actor: "scheduler"
};

const task: ClaimedWecomPublishTask = {
  taskId: "external-task-1",
  platform: "抖音",
  accountName: request.accountName,
  status: "待发布",
  title: "测试标题",
  description: "测试描述",
  videoUrl: "https://cdn.example.test/video.mp4",
  coverUrl: "https://cdn.example.test/cover.jpg"
};

function memoryRepository(overrides: Partial<PublishInterfaceClaimRepository> = {}) {
  const events: Array<{ kind: string; [key: string]: unknown }> = [];
  let blockedAlertId: string | null = null;
  const repository: PublishInterfaceClaimRepository = {
    findClaimResultUnknownAlertId: async () => blockedAlertId,
    markNoMaterial: async (slotExecutionId, nextRetryAt, actor) => {
      events.push({ kind: "NO_MATERIAL", slotExecutionId, nextRetryAt, actor });
    },
    markClaimResultUnknown: async (input) => {
      blockedAlertId = "alert-1";
      events.push({ kind: "CLAIM_RESULT_UNKNOWN", ...input });
      return { alertId: blockedAlertId };
    },
    saveClaimedTask: async (input) => {
      events.push({ kind: "CLAIMED", ...input });
      return {
        publishTaskId: "publish-task-1",
        externalTaskId: input.task.taskId
      };
    },
    recordRejected: async (input) => {
      events.push({ kind: "REJECTED", ...input });
    },
    resolveClaimResultUnknown: async (input) => {
      blockedAlertId = null;
      events.push({ kind: "RESOLVED", ...input });
      return true;
    },
    ...overrides
  };
  return { repository, events };
}

describe("interface publish single-account claim", () => {
  test("queries by the external key while validating and saving the account name", async () => {
    const { repository, events } = memoryRepository();
    const calls: string[] = [];
    const service = createPublishInterfaceClaimService({
      repository,
      now: () => now,
      claim: async (_config, externalAccountKey) => {
        calls.push(externalAccountKey);
        return { kind: "CLAIMED", task };
      }
    });

    expect(await service.claimOne(request)).toEqual({
      kind: "CLAIMED",
      publishTaskId: "publish-task-1",
      externalTaskId: task.taskId
    });
    expect(calls).toEqual(["query-41218954470"]);
    expect(events.filter((event) => event.kind === "CLAIMED")).toMatchObject([{
      accountName: "开心幸福一家人",
      task: { accountName: "开心幸福一家人" }
    }]);
  });

  test("accepts the documented external pending status", async () => {
    const { repository, events } = memoryRepository();
    const service = createPublishInterfaceClaimService({
      repository,
      now: () => now,
      claim: async () => ({
        kind: "CLAIMED",
        task: { ...task, status: "未发布" }
      } as never)
    });

    expect(await service.claimOne(request)).toMatchObject({
      kind: "CLAIMED",
      externalTaskId: task.taskId
    });
    expect(events.filter((event) => event.kind === "CLAIMED")).toHaveLength(1);
  });

  test("defers no-material by exactly ten minutes without creating a task", async () => {
    const { repository, events } = memoryRepository();
    const service = createPublishInterfaceClaimService({
      repository,
      now: () => now,
      claim: async () => ({ kind: "NO_MATERIAL" })
    });

    expect(await service.claimOne(request)).toEqual({
      kind: "NO_MATERIAL",
      nextRetryAt: new Date("2026-08-06T01:10:00.000Z")
    });
    expect(events).toEqual([{
      kind: "NO_MATERIAL",
      slotExecutionId: request.slotExecutionId,
      nextRetryAt: new Date("2026-08-06T01:10:00.000Z"),
      actor: request.actor
    }]);
  });

  test("isolates an unknown claim result and never automatically claims it again", async () => {
    const { repository, events } = memoryRepository();
    let claimCalls = 0;
    const service = createPublishInterfaceClaimService({
      repository,
      now: () => now,
      claim: async () => {
        claimCalls += 1;
        return { kind: "RESULT_UNKNOWN", code: "EXTERNAL_REQUEST_RESULT_UNKNOWN" };
      }
    });

    expect(await service.claimOne(request)).toEqual({
      kind: "CLAIM_RESULT_UNKNOWN",
      alertId: "alert-1"
    });
    expect(await service.claimOne(request)).toEqual({
      kind: "CLAIM_RESULT_UNKNOWN",
      alertId: "alert-1"
    });
    expect(claimCalls).toBe(1);
    expect(events.filter((event) => event.kind === "CLAIM_RESULT_UNKNOWN")).toHaveLength(1);
  });

  test("requires evidence for manual release and does not call the external client", async () => {
    const { repository, events } = memoryRepository();
    let claimCalls = 0;
    const service = createPublishInterfaceClaimService({
      repository,
      now: () => now,
      claim: async () => {
        claimCalls += 1;
        return { kind: "NO_MATERIAL" };
      }
    });

    await expect(service.resolveClaimResultUnknown({
      slotExecutionId: request.slotExecutionId,
      resolution: "SAFE_TO_RETRY",
      evidence: " ",
      actor: "operator-1"
    })).rejects.toThrow("CLAIM_RESULT_UNKNOWN_EVIDENCE_REQUIRED");
    expect(await service.resolveClaimResultUnknown({
      slotExecutionId: request.slotExecutionId,
      resolution: "SAFE_TO_RETRY",
      evidence: "已在外部管理端确认没有生成待处理任务",
      actor: "operator-1"
    })).toEqual({ resolved: true });
    expect(claimCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({
      kind: "RESOLVED",
      resolution: "SAFE_TO_RETRY",
      actor: "operator-1",
      resolvedAt: now
    });
  });

  test("returns the repository's existing task when an external task id is repeated", async () => {
    let saveCalls = 0;
    const { repository } = memoryRepository({
      saveClaimedTask: async (input) => {
        saveCalls += 1;
        return { publishTaskId: "existing-task", externalTaskId: input.task.taskId };
      }
    });
    const service = createPublishInterfaceClaimService({
      repository,
      now: () => now,
      claim: async () => ({ kind: "CLAIMED", task })
    });

    expect(await service.claimOne(request)).toMatchObject({
      kind: "CLAIMED",
      publishTaskId: "existing-task"
    });
    expect(saveCalls).toBe(1);
  });

  test("rejects invalid, mismatched or non-douyin tasks before persistence", async () => {
    const invalidTasks = [
      { ...task, accountName: "另一个账号" },
      { ...task, accountName: request.externalAccountKey },
      { ...task, taskId: "" },
      { ...task, platform: "视频号" }
    ];
    for (const invalidTask of invalidTasks) {
      const { repository, events } = memoryRepository();
      const service = createPublishInterfaceClaimService({
        repository,
        now: () => now,
        claim: async () => ({ kind: "CLAIMED", task: invalidTask } as never)
      });

      expect((await service.claimOne(request)).kind).toBe("REJECTED");
      expect(events.some((event) => event.kind === "CLAIMED")).toBe(false);
      expect(events.some((event) => event.kind === "REJECTED")).toBe(true);
    }
  });
});

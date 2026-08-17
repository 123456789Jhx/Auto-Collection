import { describe, expect, test } from "bun:test";
import {
  createPublishInterfaceReleaseService,
  type PublishInterfaceReleaseRepository
} from "./publish-interface-release.service";

function repositoryFor(overrides: Partial<PublishInterfaceReleaseRepository> = {}) {
  const events: unknown[] = [];
  const repository: PublishInterfaceReleaseRepository = {
    findTask: async () => ({
      publishTaskId: "task-1",
      runId: "run-1",
      bindingId: "binding-1",
      localResultStatus: null,
      sideEffectStartedAt: null
    }),
    enqueueRelease: async (input) => {
      events.push(input);
      return { outboxId: "outbox-1" };
    },
    isAccountBlocked: async () => true,
    ...overrides
  };
  return { repository, events };
}

describe("interface publish safe release", () => {
  test("queues an immutable unpublished PATCH before phone side effects start", async () => {
    const memory = repositoryFor();
    const service = createPublishInterfaceReleaseService({ repository: memory.repository });
    expect(await service.releaseBeforeSideEffect({
      publishTaskId: "task-1",
      reason: "用户停止任务",
      actor: "admin"
    })).toEqual({ outboxId: "outbox-1" });
    expect(memory.events[0]).toMatchObject({
      publishTaskId: "task-1",
      targetStatus: "未发布",
      payload: { platform: "抖音", status: "未发布", error: "用户停止任务" }
    });
  });

  test("rejects release after side effects or for result-unknown tasks", async () => {
    const started = repositoryFor({
      findTask: async () => ({
        publishTaskId: "task-1",
        runId: "run-1",
        bindingId: "binding-1",
        localResultStatus: null,
        sideEffectStartedAt: new Date("2026-08-06T01:00:00.000Z")
      })
    });
    await expect(createPublishInterfaceReleaseService({ repository: started.repository })
      .releaseBeforeSideEffect({ publishTaskId: "task-1", reason: "停止", actor: "admin" }))
      .rejects.toThrow("INTERFACE_RELEASE_SIDE_EFFECT_STARTED");

    const unknown = repositoryFor({
      findTask: async () => ({
        publishTaskId: "task-1",
        runId: "run-1",
        bindingId: "binding-1",
        localResultStatus: "RESULT_UNKNOWN",
        sideEffectStartedAt: null
      })
    });
    await expect(createPublishInterfaceReleaseService({ repository: unknown.repository })
      .releaseBeforeSideEffect({ publishTaskId: "task-1", reason: "停止", actor: "admin" }))
      .rejects.toThrow("INTERFACE_RELEASE_RESULT_UNKNOWN");
  });

  test("keeps the account blocked while release outbox is unresolved", async () => {
    const memory = repositoryFor();
    const service = createPublishInterfaceReleaseService({ repository: memory.repository });
    expect(await service.isAccountClaimBlocked("run-1", "binding-1")).toBe(true);
  });
});

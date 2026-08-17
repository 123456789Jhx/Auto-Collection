import { describe, expect, test } from "bun:test";
import {
  createPublishStatusOutbox,
  isPublishStatusOutboxReady,
  nextPublishStatusRetryAt,
  processNextPublishStatusOutbox,
  type PublishStatusOutboxEntry,
  type PublishStatusOutboxRepository
} from "./publish-status-outbox.service";
import { WecomPublishClientError } from "./wecom-publish-client";

const entry: PublishStatusOutboxEntry = {
  id: "outbox-1",
  attempts: 1,
  publishTaskId: "publish-task-1",
  targetStatus: "已发布",
  payload: { platform: "抖音", status: "已发布" }
};

function repositoryFor(claimed: PublishStatusOutboxEntry | null) {
  const events: string[] = [];
  const repository: PublishStatusOutboxRepository = {
    enqueue: async () => undefined,
    claimReady: async () => claimed,
    markReported: async () => { events.push("reported"); },
    markRetry: async (_entry, error) => { events.push("retry:" + error); },
    markManualReview: async (_entry, error) => { events.push("manual:" + error); }
  };
  return { repository, events };
}

describe("publish status outbox", () => {
  test("freezes target and payload when the outbox record is created", async () => {
    let taskStatus = "SUCCEEDED";
    let snapshot: unknown;
    const { repository } = repositoryFor(null);
    repository.enqueue = async (input) => { snapshot = input; };

    await createPublishStatusOutbox("publish-task-1", "result-service", new Date("2026-08-06T00:00:00.000Z"), {
      repository,
      loadContext: async () => ({
        task: {
          id: "publish-task-1",
          taskId: "external-task-1",
          platform: "DOUYIN",
          status: taskStatus,
          resultError: null,
          publishedUrl: "https://douyin.example.test/video/1",
          platformContentId: null
        }
      } as never)
    });
    taskStatus = "FAILED";

    expect(snapshot).toMatchObject({
      publishTaskId: "publish-task-1",
      targetStatus: "已发布",
      payload: {
        platform: "抖音",
        status: "已发布",
        publishedUrl: "https://douyin.example.test/video/1"
      }
    });
  });

  test("uses 1, 3, 10 and 30 minute retry delays and blocks early claims", () => {
    const failedAt = new Date("2026-08-06T00:00:00.000Z");
    expect([1, 2, 3, 4].map((attempt) => nextPublishStatusRetryAt(attempt, failedAt).toISOString()))
      .toEqual([
        "2026-08-06T00:01:00.000Z",
        "2026-08-06T00:03:00.000Z",
        "2026-08-06T00:10:00.000Z",
        "2026-08-06T00:30:00.000Z"
      ]);
    expect(isPublishStatusOutboxReady({
      status: "RETRY_WAIT",
      nextRetryAt: new Date("2026-08-06T00:03:00.000Z")
    }, new Date("2026-08-06T00:02:59.999Z"))).toBe(false);
    expect(isPublishStatusOutboxReady({
      status: "RETRY_WAIT",
      nextRetryAt: new Date("2026-08-06T00:03:00.000Z")
    }, new Date("2026-08-06T00:03:00.000Z"))).toBe(true);
  });

  test("patches a claimed record and marks it reported", async () => {
    const { repository, events } = repositoryFor(entry);
    const patches: unknown[] = [];
    const result = await processNextPublishStatusOutbox("outbox-worker", {
      now: new Date("2026-07-28T00:00:00.000Z"),
      repository,
      buildPatch: async () => ({
        externalTaskId: "external-task-1",
        clientConfig: {
          externalBaseUrl: "https://external.example.test",
          externalTokenEnv: "PUBLISH_EXTERNAL_TOKEN"
        },
        payload: { platform: "抖音", status: "已发布" }
      }),
      patchStatus: async (patch) => { patches.push(patch); }
    });

    expect(result.outcome).toBe("REPORTED");
    expect(events).toEqual(["reported"]);
    expect(patches).toEqual([{
      externalTaskId: "external-task-1",
      clientConfig: {
        externalBaseUrl: "https://external.example.test",
        externalTokenEnv: "PUBLISH_EXTERNAL_TOKEN"
      },
      payload: { platform: "抖音", status: "已发布" }
    }]);
  });

  test("records an error and leaves the record retryable when PATCH fails", async () => {
    const { repository, events } = repositoryFor({ ...entry, attempts: 2 });
    const result = await processNextPublishStatusOutbox("outbox-worker", {
      repository,
      buildPatch: async () => { throw new Error("upstream unavailable"); }
    });

    expect(result).toMatchObject({ outcome: "RETRY_PENDING", error: "upstream unavailable" });
    expect(events).toEqual(["retry:upstream unavailable"]);
  });

  test("moves a business conflict to manual review instead of retrying", async () => {
    const { repository, events } = repositoryFor(entry);
    const result = await processNextPublishStatusOutbox("outbox-worker", {
      repository,
      buildPatch: async () => ({
        externalTaskId: "external-task-1",
        clientConfig: {
          externalBaseUrl: "https://external.example.test",
          externalTokenEnv: "PUBLISH_EXTERNAL_TOKEN"
        },
        payload: entry.payload
      }),
      patchStatus: async () => {
        throw new WecomPublishClientError(409, "TASK_STATUS_CONFLICT", "任务状态冲突");
      }
    });

    expect(result).toMatchObject({ outcome: "MANUAL_REVIEW" });
    expect(events).toEqual(["manual:TASK_STATUS_CONFLICT"]);
  });

  test("never imports or creates a phone command while syncing external status", async () => {
    const source = await Bun.file(new URL("./publish-status-outbox.service.ts", import.meta.url)).text();
    expect(source).not.toContain("createPublishVideoTaskCommand");
    expect(source).not.toContain("PUBLISH_VIDEO_TASK");
  });

  test("returns EMPTY when no retryable record is available", async () => {
    const { repository, events } = repositoryFor(null);
    await expect(processNextPublishStatusOutbox("outbox-worker", { repository })).resolves.toEqual({ outcome: "EMPTY" });
    expect(events).toEqual([]);
  });
});

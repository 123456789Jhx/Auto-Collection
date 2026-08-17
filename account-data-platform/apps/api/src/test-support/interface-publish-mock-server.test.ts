import { describe, expect, test } from "bun:test";
import type { ClaimedWecomPublishTask } from "@pkg/types";
import { createInterfacePublishMockServer } from "./interface-publish-mock-server";

const task: ClaimedWecomPublishTask = {
  title: "Mock task",
  description: "Mock description",
  coverUrl: "https://media.example.test/cover.jpg",
  videoUrl: "https://media.example.test/video.mp4",
  platform: "抖音",
  status: "待发布",
  taskId: "mock-task-001",
  accountName: "账号 A"
};

function claim(server: ReturnType<typeof createInterfacePublishMockServer>, body: unknown) {
  return server.app.request("/api/v1/external/publish-tasks/claim", {
    method: "POST",
    headers: {
      authorization: "Bearer mock-token",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

describe("interface publish mock server", () => {
  test("serves one account queue then returns no material and rejects extra claim fields", async () => {
    const server = createInterfacePublishMockServer({ queues: { "账号 A": [task] } });
    const first = await claim(server, { platform: "抖音", accountName: "账号 A" });
    const empty = await claim(server, { platform: "抖音", accountName: "账号 A" });
    const invalid = await claim(server, {
      platform: "抖音",
      accountName: "账号 A",
      requestId: "not-supported"
    });
    expect(await first.json()).toEqual({ data: task });
    expect(await empty.json()).toEqual({ data: null });
    expect(invalid.status).toBe(400);
  });

  test("supports configured claim delay and 409 rejection", async () => {
    const server = createInterfacePublishMockServer({
      queues: {},
      claimDelayMs: 5,
      rejectedAccounts: new Set(["冲突账号"])
    });
    const startedAt = performance.now();
    const delayed = await claim(server, { platform: "抖音", accountName: "普通账号" });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(4);
    expect(delayed.status).toBe(200);
    expect((await claim(server, { platform: "抖音", accountName: "冲突账号" })).status).toBe(409);
  });

  test("makes repeated identical PATCH idempotent", async () => {
    const server = createInterfacePublishMockServer({ queues: {} });
    const patch = () => server.app.request(
      "/api/v1/external/publish-tasks/mock-task-001/status",
      {
        method: "PATCH",
        headers: {
          authorization: "Bearer mock-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          platform: "抖音",
          status: "已发布",
          publishedUrl: "https://www.douyin.com/video/1"
        })
      }
    );
    expect(await (await patch()).json()).toEqual({ data: { success: true, duplicate: false } });
    expect(await (await patch()).json()).toEqual({ data: { success: true, duplicate: true } });
    expect(server.state.patches).toHaveLength(1);
  });
});

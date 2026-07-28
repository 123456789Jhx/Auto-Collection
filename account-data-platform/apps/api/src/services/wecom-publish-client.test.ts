import { afterAll, describe, expect, test } from "bun:test";
import type { WecomPublishTask } from "@pkg/types";
import {
  claimTask,
  patchTaskStatus,
  WecomPublishClientError
} from "./wecom-publish-client";

const tokenEnv = "NODE11_WECOM_CLIENT_TEST_TOKEN";
const token = "node11-secret-token";
const config = {
  externalBaseUrl: "http://wecom.mock.local",
  externalTokenEnv: tokenEnv
};
const task = {
  title: "夏橙发布任务",
  description: "发布夏橙短视频",
  coverUrl: null,
  videoUrl: "https://media.example.test/video.mp4",
  platform: "抖音",
  status: "待发布",
  taskId: "draft-node11-client",
  accountName: "测试号001"
} satisfies WecomPublishTask;

process.env[tokenEnv] = token;

afterAll(() => {
  delete process.env[tokenEnv];
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("wecom publish client", () => {
  test("claims a task with bearer auth and redacted logs", async () => {
    const logs: string[] = [];
    let request: { url: string; init?: RequestInit } | undefined;
    const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: String(input), init };
      return jsonResponse({ data: task });
    };

    const claimed = await claimTask(config, { platform: "抖音" }, {
      fetch: fetchMock,
      logger: (entry) => logs.push(JSON.stringify(entry))
    });

    expect(claimed).toEqual(task);
    expect(request?.url).toBe("http://wecom.mock.local/api/v1/external/publish-tasks/claim");
    expect(new Headers(request?.init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
    expect(request?.init?.signal).toBeDefined();
    expect(logs.join("\n")).not.toContain(token);
  });

  test("returns null when no task is available", async () => {
    const claimed = await claimTask(config, { platform: "视频号" }, {
      fetch: async () => jsonResponse({ data: null })
    });
    expect(claimed).toBeNull();
  });

  test("maps 401 and 500 error responses", async () => {
    for (const status of [401, 500]) {
      try {
        await claimTask(config, { platform: "抖音" }, {
          fetch: async () => jsonResponse({
            error: { code: status === 401 ? "TOKEN_INVALID" : "UPSTREAM_ERROR", message: "mock failure" }
          }, status)
        });
        throw new Error("expected claimTask to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(WecomPublishClientError);
        expect((error as WecomPublishClientError).status).toBe(status);
      }
    }
  });

  test("patches external task status", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    await patchTaskStatus(config, "draft/node11", {
      platform: "抖音",
      status: "已发布",
      publishedUrl: "https://www.douyin.com/video/1",
      platformContentId: "douyin-1"
    }, {
      fetch: async (input, init) => {
        request = { url: String(input), init };
        return jsonResponse({ data: { success: true } });
      }
    });

    expect(request?.url).toBe("http://wecom.mock.local/api/v1/external/publish-tasks/draft%2Fnode11/status");
    expect(request?.init?.method).toBe("PATCH");
  });
});

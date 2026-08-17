import { afterAll, describe, expect, test } from "bun:test";
import type { WecomPublishTask } from "@pkg/types";
import {
  claimInterfacePublishTask,
  claimTask,
  patchTaskStatus,
  WecomPublishClientError
} from "./wecom-publish-client";

const tokenEnv = `INTERFACE_PUBLISH_TEST_TOKEN_${crypto.randomUUID().replaceAll("-", "")}`;
const token = "node11-secret-token";
const config = {
  externalBaseUrl: "http://wecom.mock.local",
  externalTokenEnv: tokenEnv
};
const task = {
  title: "夏橙发布任务",
  description: "发布夏橙短视频",
  coverUrl: "https://media.example.test/cover.jpg",
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
  test("fails before fetch when the configured token environment variable is missing", async () => {
    let fetchCalls = 0;
    let caught: unknown;
    const missingTokenEnv = `MISSING_INTERFACE_PUBLISH_TOKEN_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await claimTask({
        externalBaseUrl: config.externalBaseUrl,
        externalTokenEnv: missingTokenEnv
      }, { platform: "抖音", accountName: "测试号001" }, {
        fetch: async () => {
          fetchCalls += 1;
          return jsonResponse({ data: null });
        }
      });
    } catch (error) {
      caught = error;
    }

    expect(fetchCalls).toBe(0);
    expect(caught).toBeInstanceOf(WecomPublishClientError);
    expect((caught as WecomPublishClientError).code).toBe("EXTERNAL_TOKEN_ENV_MISSING");
    expect((caught as WecomPublishClientError).userMessage).toBe(
      `环境变量 ${missingTokenEnv} 未配置`
    );
  });

  test("returns an explicit claimed result with the exact first-version body", async () => {
    let requestBody: unknown;
    const result = await claimInterfacePublishTask(config, "测试号001", {
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return jsonResponse({ data: task });
      }
    });
    expect(result).toEqual({ kind: "CLAIMED", task });
    expect(requestBody).toEqual({ platform: "抖音", accountName: "测试号001" });
  });

  test("classifies an interrupted claim as result unknown without retrying or logging secrets", async () => {
    let fetchCalls = 0;
    const logs: string[] = [];
    const result = await claimInterfacePublishTask(config, "sensitive-account-name", {
      fetch: async () => {
        fetchCalls += 1;
        throw new DOMException("aborted", "AbortError");
      },
      logger: (entry) => logs.push(JSON.stringify(entry))
    });
    expect(result).toEqual({
      kind: "RESULT_UNKNOWN",
      code: "EXTERNAL_REQUEST_RESULT_UNKNOWN"
    });
    expect(fetchCalls).toBe(1);
    expect(logs.join("\n")).not.toContain(token);
    expect(logs.join("\n")).not.toContain("sensitive-account-name");
  });

  test("classifies empty, claimed and rejected responses", async () => {
    expect(await claimInterfacePublishTask(config, "empty", {
      fetch: async () => jsonResponse({ data: null })
    })).toEqual({ kind: "NO_MATERIAL" });

    for (const status of [401, 500]) {
      const result = await claimInterfacePublishTask(config, "rejected", {
        fetch: async () => jsonResponse({
          error: { code: `MOCK_${status}`, message: "mock failure" }
        }, status)
      });
      expect(result).toEqual({ kind: "REJECTED", status, code: `MOCK_${status}` });
    }
  });

  test("claims a task with bearer auth and redacted logs", async () => {
    const logs: string[] = [];
    let request: { url: string; init?: RequestInit } | undefined;
    const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: String(input), init };
      return jsonResponse({ data: task });
    };

    const claimed = await claimTask(config, { platform: "抖音", accountName: "测试号001" }, {
      fetch: fetchMock,
      logger: (entry) => logs.push(JSON.stringify(entry))
    });

    expect(claimed).toEqual(task);
    expect(request?.url).toBe("http://wecom.mock.local/api/v1/external/publish-tasks/claim");
    expect(new Headers(request?.init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      platform: "抖音",
      accountName: "测试号001"
    });
    expect(request?.init?.signal).toBeDefined();
    expect(logs.join("\n")).not.toContain(token);
  });

  test("returns null when no task is available", async () => {
    const claimed = await claimTask(config, { platform: "视频号", accountName: "视频号测试001" }, {
      fetch: async () => jsonResponse({ data: null })
    });
    expect(claimed).toBeNull();
  });

  test("maps 401 and 500 error responses", async () => {
    for (const status of [401, 500]) {
      try {
        await claimTask(config, { platform: "抖音", accountName: "测试号001" }, {
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

  test("rejects a claim without accountName before sending a request", async () => {
    let fetchCalls = 0;
    await expect(claimTask(config, { platform: "抖音" } as never, {
      fetch: async () => {
        fetchCalls += 1;
        return jsonResponse({ data: null });
      }
    })).rejects.toThrow();
    expect(fetchCalls).toBe(0);
  });
});

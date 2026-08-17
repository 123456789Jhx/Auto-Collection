import { describe, expect, test } from "bun:test";
import { fetchSingleDouyinPublishTask } from "./single-interface-publish-client";

describe("fetchSingleDouyinPublishTask", () => {
  test("queries one unpublished task by douyinId with a server-side bearer token", async () => {
    process.env.PUBLISH_EXTERNAL_TOKEN = "secret-token";
    let request: { url: string; init?: RequestInit } | undefined;

    const task = await fetchSingleDouyinPublishTask("23362504586", {
      fetch: async (input, init) => {
        request = { url: String(input), init };
        return Response.json({ data: [{
          taskId: "external-task-1",
          accountName: "勤能致富",
          platform: "抖音",
          status: "未发布",
          title: "乡下慢生活真的轻松吗",
          description: "乡村生活 #三农",
          videoUrl: "https://media.example.test/video.mp4",
          coverUrl: "https://media.example.test/cover.jpg"
        }] });
      }
    });

    expect(request?.url).toBe("https://wecom.dafengchan.top/api/v1/external/douyin-accounts/23362504586/publish-tasks?status=%E6%9C%AA%E5%8F%91%E5%B8%83&page=1&pageSize=1");
    expect(new Headers(request?.init?.headers).get("Authorization")).toBe("Bearer secret-token");
    expect(task).toMatchObject({ taskId: "external-task-1", accountName: "勤能致富" });
  });

  test("returns null when the account has no unpublished material", async () => {
    process.env.PUBLISH_EXTERNAL_TOKEN = "secret-token";
    const task = await fetchSingleDouyinPublishTask("23362504586", {
      fetch: async () => Response.json({ data: [] })
    });
    expect(task).toBeNull();
  });
});

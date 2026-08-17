import { describe, expect, test } from "bun:test";
import {
  claimPublishTaskPayloadSchema,
  claimPublishTaskResponseSchema,
  patchPublishTaskStatusPayloadSchema,
  toPublishPlatform,
  toPublishTaskStatus,
  wecomPublishTaskSchema
} from "./wecom-publish";
import type { WecomPublishTask } from "./wecom-publish";

const externalTask = {
  title: "夏橙发布任务",
  description: "发布夏橙短视频",
  coverUrl: "https://media.example.test/cover.jpg",
  videoUrl: "https://media.example.test/video.mp4",
  platform: "抖音",
  status: "待发布",
  taskId: "draft-node11-001",
  accountName: "测试号001"
} satisfies WecomPublishTask;

describe("wecom publish contracts", () => {
  test("parses the eight-field task and maps Chinese enums", () => {
    expect(wecomPublishTaskSchema.parse(externalTask)).toEqual(externalTask);
    expect(wecomPublishTaskSchema.parse({ ...externalTask, accountName: null }).accountName).toBeNull();
    expect(toPublishPlatform("抖音")).toBe("DOUYIN");
    expect(toPublishPlatform("视频号")).toBe("WECHAT_CHANNELS");
    expect(wecomPublishTaskSchema.parse({ ...externalTask, status: "未发布" }).status).toBe("未发布");
    expect(toPublishTaskStatus("未发布")).toBe("PENDING");
    expect(toPublishTaskStatus("待发布")).toBe("PENDING");
    expect(toPublishTaskStatus("已发布")).toBe("PUBLISHED");
  });

  test("validates claim and status patch payloads strictly", () => {
    expect(claimPublishTaskPayloadSchema.parse({ platform: "抖音", accountName: "测试号001" })).toEqual({
      platform: "抖音",
      accountName: "测试号001"
    });
    expect(patchPublishTaskStatusPayloadSchema.parse({
      platform: "视频号",
      status: "已发布",
      publishedUrl: "https://channels.example.test/post/1",
      platformContentId: "channels-1"
    }).status).toBe("已发布");
    expect(() => wecomPublishTaskSchema.parse({ ...externalTask, coverUrl: null })).toThrow();
    expect(() => wecomPublishTaskSchema.parse({ ...externalTask, coverUrl: "" })).toThrow();
    expect(() => wecomPublishTaskSchema.parse({ ...externalTask, coverUrl: "ftp://media.example.test/cover.jpg" })).toThrow();
    expect(() => wecomPublishTaskSchema.parse({ ...externalTask, extra: true })).toThrow();
    expect(() => patchPublishTaskStatusPayloadSchema.parse({ platform: "抖音", status: "待发布" })).toThrow();
    expect(claimPublishTaskResponseSchema.parse({
      data: { ...externalTask, coverUrl: null, videoUrl: "ftp://media.example.test/video.mp4" }
    }).data).toMatchObject({ coverUrl: null, videoUrl: "ftp://media.example.test/video.mp4" });
  });

  test("requires a non-empty account name for every claim", () => {
    expect(() => claimPublishTaskPayloadSchema.parse({ platform: "抖音" })).toThrow();
    expect(() => claimPublishTaskPayloadSchema.parse({ platform: "抖音", accountName: "" })).toThrow();
    expect(() => claimPublishTaskPayloadSchema.parse({ platform: "抖音", accountName: "   " })).toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import {
  completePublishTopicsPayloadSchema,
  dispatchPublishTasksPayloadSchema,
  manualPublishTestPayloadSchema,
  publishTaskResultPayloadSchema
} from "./publish-task";

const manualPublishPayload = {
  configId: "5b80c794-44dc-4a5e-b25c-556fdcd1530b",
  deviceId: "d59e4f98-1cd3-4b83-bb93-51d8e3c44410",
  platform: "\u6296\u97f3",
  videoUrl: "https://media.example.test/videos/summer.mp4",
  coverUrl: "https://media.example.test/covers/summer.jpg",
  title: "Summer collection",
  description: "A short collection for publishing.",
  source: "MANUAL_TEST"
} as const;

describe("publish task contracts", () => {
  test("parses a manual publish payload with a supported source", () => {
    expect(manualPublishTestPayloadSchema.parse(manualPublishPayload)).toEqual(manualPublishPayload);
    expect(manualPublishTestPayloadSchema.parse({
      ...manualPublishPayload,
      source: "QUICK_PASTE"
    }).source).toBe("QUICK_PASTE");
  });

  test("rejects invalid manual publish material and unexpected fields", () => {
    expect(() => manualPublishTestPayloadSchema.parse({
      ...manualPublishPayload,
      videoUrl: "not-a-url"
    })).toThrow();
    expect(() => manualPublishTestPayloadSchema.parse({
      ...manualPublishPayload,
      title: "   "
    })).toThrow();
    expect(() => manualPublishTestPayloadSchema.parse({
      ...manualPublishPayload,
      extra: true
    })).toThrow();
  });

  test("parses publish result reports for successful and pending work", () => {
    expect(publishTaskResultPayloadSchema.parse({
      deviceId: " device-001 ",
      deviceToken: "device-token",
      status: "SUCCEEDED",
      publishedUrl: "https://douyin.example.test/posts/123",
      platformContentId: "post-123"
    })).toEqual({
      deviceId: "device-001",
      deviceToken: "device-token",
      status: "SUCCEEDED",
      publishedUrl: "https://douyin.example.test/posts/123",
      platformContentId: "post-123"
    });
    expect(publishTaskResultPayloadSchema.parse({
      deviceId: "device-001",
      deviceToken: "device-token",
      status: "TOPIC_PENDING"
    }).status).toBe("TOPIC_PENDING");
  });

  test("rejects incomplete or malformed publish result reports", () => {
    expect(() => publishTaskResultPayloadSchema.parse({
      deviceId: "device-001",
      deviceToken: "",
      status: "FAILED"
    })).toThrow();
    expect(() => publishTaskResultPayloadSchema.parse({
      deviceId: "device-001",
      deviceToken: "device-token",
      status: "UNKNOWN"
    })).toThrow();
    expect(() => publishTaskResultPayloadSchema.parse({
      deviceId: "device-001",
      deviceToken: "device-token",
      status: "FAILED",
      error: "   "
    })).toThrow();
    expect(() => publishTaskResultPayloadSchema.parse({
      deviceId: "device-001",
      deviceToken: "device-token",
      status: "FAILED",
      extra: true
    })).toThrow();
  });

  test("trims completed topics and rejects empty topic completion payloads", () => {
    expect(completePublishTopicsPayloadSchema.parse({
      description: "  Add #summer #travel  "
    })).toEqual({ description: "Add #summer #travel" });
    expect(() => completePublishTopicsPayloadSchema.parse({ description: "   " })).toThrow();
    expect(() => completePublishTopicsPayloadSchema.parse({
      description: "Add #summer",
      extra: true
    })).toThrow();
  });

  test("accepts only a strict UUID configuration when dispatching publish tasks", () => {
    expect(dispatchPublishTasksPayloadSchema.parse({
      configId: "5b80c794-44dc-4a5e-b25c-556fdcd1530b"
    })).toEqual({ configId: "5b80c794-44dc-4a5e-b25c-556fdcd1530b" });
    expect(() => dispatchPublishTasksPayloadSchema.parse({ configId: "config-001" })).toThrow();
    expect(() => dispatchPublishTasksPayloadSchema.parse({
      configId: "5b80c794-44dc-4a5e-b25c-556fdcd1530b",
      limit: 1
    })).toThrow();
  });
});

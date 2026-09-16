import { describe, expect, it } from "bun:test";
import { buildLiveRoomProfilePrompt, profileErrorMessage, requestLiveRoomProfile } from "./live-room-profile-model";

const input = { roomKey: "capture:1", comments: [{ commentText: "有没有大码", userName: "不应上传的用户名" }] };
const connection = { apiKey: "test-only-key", baseUrl: "https://model.example/v1" };
const profile = {
  summary: "关注服装尺码",
  audienceFeatures: ["询问商品规格的人群"],
  interestNeeds: ["大码服饰"],
  interactionTraits: ["主动提问"],
  evidenceComments: [{ text: "有没有大码", reason: "提出明确的尺码需求", confidence: "中" }],
  confidence: "低",
  confidenceExplanation: "仅一条评论，不能推断人口属性或购买行为"
};
const response = (value = profile) => Response.json({
  status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }]
});

describe("live room model request", () => {
  it("uses Responses, GPT-5.5 and built-in instructions without uploading usernames", async () => {
    const result = await requestLiveRoomProfile(input, connection, async (url, init) => {
      expect(url).toBe("https://model.example/v1/responses");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-only-key");
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ model: "gpt-5.5", store: false, reasoning: { effort: "xhigh" } });
      expect(body.instructions).toContain("用户画像");
      expect(body.input).toContain("有没有大码");
      expect(body.input).not.toContain("不应上传的用户名");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return response();
    });
    expect(result).toEqual(profile);
  });

  it("accepts an already complete Responses URL", async () => {
    await requestLiveRoomProfile(input, { ...connection, baseUrl: "https://model.example/v1/responses/" }, async (url) => {
      expect(url).toBe("https://model.example/v1/responses");
      return response();
    });
  });

  it("does not make a request without credentials or comments", async () => {
    let calls = 0;
    const send = async () => { calls += 1; return response(); };
    await expect(requestLiveRoomProfile(input, { ...connection, apiKey: " " }, send)).rejects.toThrow("AI_API_KEY_NOT_CONFIGURED");
    await expect(requestLiveRoomProfile({ ...input, comments: [] }, connection, send)).rejects.toThrow("AI_COMMENTS_EMPTY");
    expect(calls).toBe(0);
  });

  it("reports authentication failure without returning the provider body", async () => {
    await expect(requestLiveRoomProfile(input, connection, async () => new Response("private upstream text", { status: 401 })))
      .rejects.toThrow("AI_REQUEST_FAILED_401");
    expect(profileErrorMessage(new Error("AI_REQUEST_FAILED_401"))).toContain("密钥无效");
    expect(profileErrorMessage(new Error("private upstream text"))).not.toContain("private upstream text");
  });

  it("rejects evidence not present in this room's sample", async () => {
    await expect(requestLiveRoomProfile(input, connection, async () => response({
      ...profile, evidenceComments: [{ text: "另一直播间的评论", reason: "错误引用", confidence: "高" }]
    }))).rejects.toThrow("AI_EVIDENCE_INVALID");
  });

  it("reports malformed response bodies", async () => {
    await expect(requestLiveRoomProfile(input, connection, async () => new Response("<html>unavailable</html>")))
      .rejects.toThrow("AI_RESPONSE_INVALID_JSON");
  });

  it("reports a timeout both before and after response headers", async () => {
    await expect(requestLiveRoomProfile(input, connection, async () => { throw new DOMException("timeout", "TimeoutError"); }))
      .rejects.toThrow("AI_REQUEST_TIMEOUT");
    const stalled = new Response(new ReadableStream({
      start(controller) { controller.error(new DOMException("timeout", "TimeoutError")); }
    }));
    await expect(requestLiveRoomProfile(input, connection, async () => stalled)).rejects.toThrow("AI_REQUEST_TIMEOUT");
  });

  it("reports sample limits without deduplicating original comments", () => {
    const prompt = buildLiveRoomProfilePrompt({ ...input, comments: Array.from({ length: 205 }, () => ({ commentText: "重复评论" })) });
    expect(prompt).toContain('"totalCommentCount": 205');
    expect(prompt).toContain('"sampleCommentCount": 200');
    expect(prompt).toContain("仅使用前200条有效评论");
  });
});

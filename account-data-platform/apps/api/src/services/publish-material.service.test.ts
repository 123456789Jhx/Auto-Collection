import { describe, expect, test } from "bun:test";
import { normalizeExternalPublishMaterial } from "./publish-material.service";

describe("publish material preview conversion", () => {
  test("derives the cover from the same COS bucket as the converted video", () => {
    const id = "9e2a3957-f0e1-48ff-9eba-6d8a9ae052d0";

    expect(normalizeExternalPublishMaterial({
      videoUrl: `https://preview.example.test/public/downloads/${id}.mp4`,
      coverUrl: null
    })).toEqual({
      valid: true,
      videoUrl: `https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/${id}.mp4`,
      coverUrl: `https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/covers/${id}.jpg`
    });
  });

  test("rejects media hosts outside the configured allowlist", () => {
    expect(normalizeExternalPublishMaterial({
      videoUrl: "https://untrusted.example.test/video.mp4",
      coverUrl: "https://trusted.example.test/cover.jpg"
    }, {
      allowedHosts: ["trusted.example.test"]
    })).toEqual({ valid: false, code: "VIDEO_URL_INVALID" });
  });

  test("validates material without downloading or probing either URL", () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("material validation must not fetch");
    }) as unknown as typeof fetch;
    try {
      expect(normalizeExternalPublishMaterial({
        videoUrl: "https://cdn.example.test/video.mp4",
        coverUrl: "https://cdn.example.test/cover.jpg"
      }, {
        allowedHosts: ["cdn.example.test"]
      })).toMatchObject({ valid: true });
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

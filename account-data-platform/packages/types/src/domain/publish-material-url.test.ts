import { describe, expect, test } from "bun:test";
import { resolvePublishMaterialUrls } from "./publish-material-url";

describe("shared publish material URL resolution", () => {
  test("converts the existing UUID preview URL to the exact COS video and cover pair", () => {
    const draftId = "90d67320-1c4f-4b09-88d1-0054249a11bc";
    expect(resolvePublishMaterialUrls({
      videoUrl: `https://jwai.086yx.com:3722/public/downloads/${draftId}.mp4`,
      coverUrl: null
    })).toEqual({
      valid: true,
      material: {
        sourceVideoUrl: `https://jwai.086yx.com:3722/public/downloads/${draftId}.mp4`,
        sourceCoverUrl: null,
        videoUrl: `https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/${draftId}.mp4`,
        coverUrl: `https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/covers/${draftId}.jpg`,
        draftId
      }
    });
  });

  test("keeps real media URLs and prefers an explicit cover", () => {
    expect(resolvePublishMaterialUrls({
      videoUrl: "https://cdn.example.test/demo.mp4?token=video#fragment",
      coverUrl: "https://cdn.example.test/explicit.jpg?token=cover#fragment"
    })).toEqual({
      valid: true,
      material: {
        sourceVideoUrl: "https://cdn.example.test/demo.mp4?token=video#fragment",
        sourceCoverUrl: "https://cdn.example.test/explicit.jpg?token=cover#fragment",
        videoUrl: "https://cdn.example.test/demo.mp4?token=video#fragment",
        coverUrl: "https://cdn.example.test/explicit.jpg?token=cover#fragment",
        draftId: "demo"
      }
    });
  });

  test("rejects unsupported protocols and incomplete preview URLs", () => {
    expect(resolvePublishMaterialUrls({ videoUrl: "ftp://cdn.example.test/demo.mp4" }))
      .toEqual({ valid: false, code: "VIDEO_URL_INVALID" });
    expect(resolvePublishMaterialUrls({
      videoUrl: "https://preview.example.test/public/downloads/not-a-uuid.mp4"
    })).toEqual({ valid: false, code: "VIDEO_URL_INVALID" });
  });
});

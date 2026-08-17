import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { parseMediaUrlPair } from "../src/lib/media-url-pair";

describe("media URL pair parser", () => {
  test("uses the shared material resolver instead of duplicate conversion constants", async () => {
    const source = fs.readFileSync(path.join(import.meta.dir, "../src/lib/media-url-pair.ts"), "utf8");
    expect(source).toContain("resolvePublishMaterialUrls");
    expect(source).not.toContain("REAL_VIDEO_BASE_URL");
    expect(source).not.toContain("REAL_COVER_BASE_URL");
  });

  test("derives a jpg cover for one mp4", () => {
    expect(parseMediaUrlPair("https://cdn.example.com/video/demo.mp4")).toEqual({
      videoUrl: "https://cdn.example.com/video/demo.mp4",
      coverUrl: "https://cdn.example.com/video/demo.jpg",
      videoId: "demo",
      coverSource: "derived",
      errors: []
    });
  });

  test("uses an explicit jpg cover and preserves its query and hash", () => {
    const result = parseMediaUrlPair(
      "https://cdn.example.com/video/demo.mp4?videoToken=one#video https://cdn.example.com/video/demo.jpg?coverToken=two#cover"
    );

    expect(result).toMatchObject({
      videoUrl: "https://cdn.example.com/video/demo.mp4?videoToken=one#video",
      coverUrl: "https://cdn.example.com/video/demo.jpg?coverToken=two#cover",
      videoId: "demo",
      coverSource: "provided",
      errors: []
    });
  });

  test("finds a cover before the video", () => {
    expect(parseMediaUrlPair(
      "https://cdn.example.com/video/demo.jpeg https://cdn.example.com/video/demo.mp4"
    )).toMatchObject({
      videoUrl: "https://cdn.example.com/video/demo.mp4",
      coverUrl: "https://cdn.example.com/video/demo.jpeg",
      coverSource: "provided",
      errors: []
    });
  });

  test("recognizes an mp4 pathname while preserving its query", () => {
    expect(parseMediaUrlPair("https://cdn.example.com/video/demo.mp4?token=video")).toEqual({
      videoUrl: "https://cdn.example.com/video/demo.mp4?token=video",
      coverUrl: "https://cdn.example.com/video/demo.jpg",
      videoId: "demo",
      coverSource: "derived",
      errors: []
    });
  });

  test("recognizes a jpg pathname with a query", () => {
    expect(parseMediaUrlPair(
      "https://cdn.example.com/video/demo.mp4 https://cdn.example.com/video/demo.jpg?token=cover"
    )).toMatchObject({
      coverUrl: "https://cdn.example.com/video/demo.jpg?token=cover",
      coverSource: "provided",
      errors: []
    });
  });

  test("reports multiple videos while retaining the first proposed pair", () => {
    const result = parseMediaUrlPair(
      "https://cdn.example.com/one.mp4 https://cdn.example.com/two.mp4"
    );

    expect(result).toMatchObject({
      videoUrl: "https://cdn.example.com/one.mp4",
      coverUrl: "https://cdn.example.com/one.jpg",
      coverSource: "derived"
    });
    expect(result.errors).toContain("发现多个视频 URL，请拆成多条任务或只保留一个");
  });

  test("reports multiple covers while retaining the first explicit cover", () => {
    const result = parseMediaUrlPair(
      "https://cdn.example.com/demo.mp4 https://cdn.example.com/one.jpg https://cdn.example.com/two.jpeg"
    );

    expect(result).toMatchObject({
      coverUrl: "https://cdn.example.com/one.jpg",
      coverSource: "provided"
    });
    expect(result.errors).toContain("发现多个封面 URL，请只保留一个");
  });

  test("reports a missing video when only a cover exists", () => {
    expect(parseMediaUrlPair("https://cdn.example.com/demo.jpg")).toEqual({
      videoUrl: null,
      coverUrl: "https://cdn.example.com/demo.jpg",
      videoId: null,
      coverSource: "provided",
      errors: ["缺少视频 URL"]
    });
  });

  test("reports a missing material URL for plain text", () => {
    expect(parseMediaUrlPair("没有任何素材链接")).toEqual({
      videoUrl: null,
      coverUrl: null,
      videoId: null,
      coverSource: "missing",
      errors: ["缺少素材 URL"]
    });
  });

  test("rejects non-http URLs", () => {
    expect(parseMediaUrlPair("ftp://cdn.example.com/demo.mp4")).toEqual({
      videoUrl: null,
      coverUrl: null,
      videoId: null,
      coverSource: "missing",
      errors: ["素材 URL 必须使用 http 或 https 协议"]
    });
  });

  test("converts a public downloads UUID preview URL to real video and cover URLs", () => {
    expect(parseMediaUrlPair("https://jwai.086yx.com:3722/public/downloads/90d67320-1c4f-4b09-88d1-0054249a11bc.mp4")).toEqual({
      videoUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/90d67320-1c4f-4b09-88d1-0054249a11bc.mp4",
      coverUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/covers/90d67320-1c4f-4b09-88d1-0054249a11bc.jpg",
      videoId: "90d67320-1c4f-4b09-88d1-0054249a11bc",
      coverSource: "derived",
      errors: []
    });
  });

  test("rejects a public downloads preview URL that cannot be converted", () => {
    expect(parseMediaUrlPair("https://jwai.086yx.com:3722/public/downloads/demo-001.mp4")).toEqual({
      videoUrl: null,
      coverUrl: null,
      videoId: null,
      coverSource: "missing",
      errors: ["检测到无法自动转换的预览下载地址，请粘贴原始 COS/OSS 素材地址"]
    });
  });

  test("rejects an agent downloads preview URL", () => {
    expect(parseMediaUrlPair("https://admin.example.com/downloads/agent/demo-002.mp4")).toMatchObject({
      videoUrl: null,
      coverUrl: null,
      coverSource: "missing",
      errors: ["检测到无法自动转换的预览下载地址，请粘贴原始 COS/OSS 素材地址"]
    });
  });

  test("prefers explicit real media URLs over a mixed preview URL", () => {
    const result = parseMediaUrlPair([
      "https://jwai.086yx.com:3722/public/downloads/demo-003.mp4",
      "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/demo-003.mp4?sign=video#video",
      "https://media-auto.oss-cn-wuhan-lr.aliyuncs.com/covers/demo-003.jpg?sign=cover#cover"
    ].join(" "));

    expect(result).toEqual({
      videoUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/demo-003.mp4?sign=video#video",
      coverUrl: "https://media-auto.oss-cn-wuhan-lr.aliyuncs.com/covers/demo-003.jpg?sign=cover#cover",
      videoId: "demo-003",
      coverSource: "provided",
      errors: []
    });
  });
});

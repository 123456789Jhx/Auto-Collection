import { describe, expect, test } from "bun:test";
import {
  buildManualPublishPayloads,
  deriveCoverUrl,
  extractTopics,
  extractVideoId,
  parseQuickPasteText,
  resolveDefaultDirectMaterialConfig,
  validatePublishDescriptionTopics,
  validateTopicDescription
} from "../src/lib/quick-paste-publish";

const validText = [
  "成片/封面：https://cdn.example.com/materials/demo-001.mp4?signature=keep https://cdn.example.com/materials/cover-001.jpg?version=2#top",
  "抖音标题: 夏收记录",
  "抖音描述：保留完整描述 #农业 #丰收 #乡村 #种植 #夏收"
].join("\r\n");

describe("quick paste publish parser", () => {
  test("parses three lines with an explicit cover and preserves its query/hash", () => {
    const result = parseQuickPasteText(validText);

    expect(result.errors).toEqual([]);
    expect(result.value).toEqual({
      videoUrl: "https://cdn.example.com/materials/demo-001.mp4?signature=keep",
      videoId: "demo-001",
      coverUrl: "https://cdn.example.com/materials/cover-001.jpg?version=2#top",
      coverSource: "provided",
      title: "夏收记录",
      description: "保留完整描述 #农业 #丰收 #乡村 #种植 #夏收",
      topics: ["农业", "丰收", "乡村", "种植", "夏收"]
    });
  });

  test("supports four lines and derives a cover when none is explicitly provided", () => {
    const result = parseQuickPasteText([
      "成片：https://cdn.example.com/materials/demo-002.mp4?signature=keep",
      "封面：",
      "标题：秋收记录",
      "描述：保留完整描述 #农业 #丰收 #乡村 #种植 #秋收"
    ].join("\n"));

    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({
      videoId: "demo-002",
      coverUrl: "https://cdn.example.com/materials/demo-002.jpg",
      coverSource: "derived",
      title: "秋收记录"
    });
  });

  test("accepts both colon styles and rejects an invalid line count", () => {
    expect(parseQuickPasteText([
      "成片/封面: https://cdn.example.com/a.mp4",
      "标题：标题",
      "描述: #一 #二 #三 #四 #五"
    ].join("\n")).errors).toEqual([]);
    expect(parseQuickPasteText("成片/封面：https://cdn.example.com/a.mp4\n标题：标题").errors)
      .toContain("粘贴内容必须包含 3 行或 4 行");
  });

  test("reuses media parsing for invalid media and keeps topic validation", () => {
    expect(extractVideoId("https://cdn.example.com/a.MP4")).toBe("a");
    expect(deriveCoverUrl("https://cdn.example.com/path/a.mp4?token=1")).toBe("https://cdn.example.com/path/a.jpg");
    expect(parseQuickPasteText(validText.replace("demo-001.mp4?signature=keep", "demo-001.mov")).errors)
      .toContain("缺少视频 URL");
    expect(parseQuickPasteText(validText.replace("#农业 #丰收 #乡村 #种植 #夏收", "#农业 ##乡村 #种植 #夏收")).errors)
      .toContain("每个 # 后必须紧跟非空话题文字");
  });

  test("extracts five topics and fans out independent platform payloads", () => {
    expect(extractTopics("#农业 #丰收 #乡村 #种植 #夏收")).toEqual(["农业", "丰收", "乡村", "种植", "夏收"]);
    const parsed = parseQuickPasteText(validText).value;
    if (!parsed) throw new Error("expected parsed text");

    expect(buildManualPublishPayloads({
      configId: "config-id",
      deviceId: "device-id",
      platforms: ["抖音", "视频号"],
      parsed
    })).toEqual([
      {
        configId: "config-id",
        deviceId: "device-id",
        platform: "抖音",
        source: "QUICK_PASTE",
        videoUrl: parsed.videoUrl,
        coverUrl: parsed.coverUrl,
        title: parsed.title,
        description: parsed.description
      },
      {
        configId: "config-id",
        deviceId: "device-id",
        platform: "视频号",
        source: "QUICK_PASTE",
        videoUrl: parsed.videoUrl,
        coverUrl: parsed.coverUrl,
        title: parsed.title,
        description: parsed.description
      }
    ]);
  });
  test("shares topic validation for five and configured counts", () => {
    expect(validateTopicDescription("#一 #二 #三 #四 #五")).toMatchObject({ valid: true, actualCount: 5 });
    expect(validateTopicDescription("#一 #二 #三 #四")).toMatchObject({ valid: false, actualCount: 4, reason: "应有5个#，实际4个" });
    expect(validateTopicDescription("#一 #二 #三", 3)).toMatchObject({ valid: true, actualCount: 3 });
    expect(validateTopicDescription("#一 #二 #三 #四 #")).toMatchObject({ valid: false, reason: "第5个#后无文字" });
  });

  test("converts a preview download URL in three-line paste content", () => {
    const result = parseQuickPasteText([
      "成片/封面：https://jwai.086yx.com:3722/public/downloads/90d67320-1c4f-4b09-88d1-0054249a11bc.mp4",
      "标题：预览地址自动转换",
      "描述：测试内容 #一 #二 #三 #四 #五"
    ].join("\n"));

    expect(result).toMatchObject({
      errors: [],
      value: {
        videoUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/90d67320-1c4f-4b09-88d1-0054249a11bc.mp4",
        coverUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/covers/90d67320-1c4f-4b09-88d1-0054249a11bc.jpg",
        videoId: "90d67320-1c4f-4b09-88d1-0054249a11bc",
        coverSource: "derived"
      }
    });
  });

  test("uses explicit COS video and OSS cover from four-line paste content", () => {
    const result = parseQuickPasteText([
      "成片：https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/demo-005.mp4?sign=video",
      "封面：https://media-auto.oss-cn-wuhan-lr.aliyuncs.com/covers/demo-005.jpg?sign=cover#cover",
      "标题：真实素材地址",
      "描述：测试内容 #一 #二 #三 #四 #五"
    ].join("\n"));

    expect(result).toMatchObject({
      errors: [],
      value: {
        videoUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/demo-005.mp4?sign=video",
        coverUrl: "https://media-auto.oss-cn-wuhan-lr.aliyuncs.com/covers/demo-005.jpg?sign=cover#cover",
        coverSource: "provided"
      }
    });
  });

  test("prefers real media URLs when paste content also includes a preview URL", () => {
    const result = parseQuickPasteText([
      "成片/封面：https://jwai.086yx.com:3722/public/downloads/90d67320-1c4f-4b09-88d1-0054249a11bc.mp4 https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/demo-006.mp4 https://media-auto.oss-cn-wuhan-lr.aliyuncs.com/covers/demo-006.jpg",
      "标题：真实地址优先",
      "描述：测试内容 #一 #二 #三 #四 #五"
    ].join("\n"));

    expect(result).toMatchObject({
      errors: [],
      value: {
        videoUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/demo-006.mp4",
        coverUrl: "https://media-auto.oss-cn-wuhan-lr.aliyuncs.com/covers/demo-006.jpg",
        coverSource: "provided"
      }
    });
  });
});

test("uses the default execution configuration topic count and rejects ambiguous defaults", () => {
  const threeTopicText = validText.replace("#农业 #丰收 #乡村 #种植 #夏收", "#农业 #丰收 #乡村");
  expect(parseQuickPasteText(threeTopicText, 3).errors).toEqual([]);
  expect(parseQuickPasteText(threeTopicText).errors).toContain("描述必须恰好包含 5 个 #话题");
  expect(validatePublishDescriptionTopics("#一 #二 #三", 3)).toMatchObject({ valid: true, actualCount: 3 });

  const configs = [
    { id: "default-a", status: "ENABLED", configPayload: { sourceMode: "direct_material", isDefault: true } },
    { id: "default-b", status: "ENABLED", configPayload: { sourceMode: "direct_material", isDefault: true } }
  ];
  expect(resolveDefaultDirectMaterialConfig(configs)).toMatchObject({ config: null, issue: "multiple" });
  expect(resolveDefaultDirectMaterialConfig([
    { id: "fallback", status: "ENABLED", configPayload: { sourceMode: "direct_material", isDefault: false } }
  ])).toMatchObject({ config: { id: "fallback" }, issue: "fallback" });
});

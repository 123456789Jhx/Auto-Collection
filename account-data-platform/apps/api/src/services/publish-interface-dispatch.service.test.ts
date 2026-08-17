import { describe, expect, test } from "bun:test";
import {
  createPublishInterfaceDispatchService,
  type PublishInterfaceDispatchStore
} from "./publish-interface-dispatch.service";

const commandConfig = {
  responseDelayMsMin: 100,
  responseDelayMsMax: 200,
  actionWaitMsMin: 300,
  actionWaitMsMax: 400,
  expectedTopicCount: 5,
  topicResolveTimeoutMinutes: 10
};

function task() {
  return {
    id: "publish-task-1",
    matchedDeviceId: "device-1",
    platform: "DOUYIN",
    title: "标题",
    description: "描述",
    videoUrl: "https://preview.example.test/public/downloads/90d67320-1c4f-4b09-88d1-0054249a11bc.mp4",
    coverUrl: null,
    rawPayload: { taskId: "external-task-1" }
  };
}

describe("interface publish dispatch", () => {
  test("persists source and resolved URLs before calling the mature command builder once", async () => {
    const order: string[] = [];
    let savedMaterial: unknown;
    const store: PublishInterfaceDispatchStore = {
      loadTask: async () => {
        order.push("load");
        return task();
      },
      saveResolvedMaterial: async (_id, material) => {
        order.push("save");
        savedMaterial = material;
        return { ...task(), videoUrl: material.videoUrl, coverUrl: material.coverUrl };
      },
      markDispatched: async () => {
        order.push("mark");
      }
    };
    let commandCalls = 0;
    const service = createPublishInterfaceDispatchService({
      transaction: async (work) => work(store),
      createCommand: async () => {
        commandCalls += 1;
        order.push("command");
        return { command: { id: "command-1" }, idempotent: false };
      }
    });

    expect(await service.dispatch({
      publishTaskId: "publish-task-1",
      allowedHosts: [
        "preview.example.test",
        "aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com"
      ],
      commandConfig,
      actor: "scheduler"
    })).toMatchObject({ commandId: "command-1", idempotent: false });
    expect(order).toEqual(["load", "save", "command", "mark"]);
    expect(commandCalls).toBe(1);
    expect(savedMaterial).toMatchObject({
      sourceVideoUrl: task().videoUrl,
      sourceCoverUrl: null,
      videoUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/videos/90d67320-1c4f-4b09-88d1-0054249a11bc.mp4",
      coverUrl: "https://aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com/covers/90d67320-1c4f-4b09-88d1-0054249a11bc.jpg"
    });
  });

  test("returns the existing idempotent command for a repeated dispatch", async () => {
    const store: PublishInterfaceDispatchStore = {
      loadTask: async () => task(),
      saveResolvedMaterial: async (_id, material) => ({
        ...task(),
        videoUrl: material.videoUrl,
        coverUrl: material.coverUrl
      }),
      markDispatched: async () => undefined
    };
    const service = createPublishInterfaceDispatchService({
      transaction: async (work) => work(store),
      createCommand: async () => ({
        command: { id: "existing-command" },
        idempotent: true
      })
    });

    expect(await service.dispatch({
      publishTaskId: "publish-task-1",
      allowedHosts: [
        "preview.example.test",
        "aishortvideo-1300891832.cos.ap-guangzhou.myqcloud.com"
      ],
      commandConfig,
      actor: "scheduler"
    })).toMatchObject({ commandId: "existing-command", idempotent: true });
  });

  test("imports the mature command builder without copying phone actions", async () => {
    const source = await Bun.file(new URL("./publish-interface-dispatch.service.ts", import.meta.url)).text();
    expect(source).toContain("createPublishVideoTaskCommand");
    expect(source).not.toContain('commandType: "PUBLISH_VIDEO_TASK"');
    expect(source).not.toContain("mobile-agent");
    expect(source).not.toContain("execute-publish");
  });
});

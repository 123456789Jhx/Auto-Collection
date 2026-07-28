import { describe, expect, test } from "bun:test";
import { listDefinitions } from "../repositories/remote-script.repository";
import {
  remoteScriptRegistry,
  syncRemoteScriptDefinitions
} from "./remote-script-registry";

describe("remote script registry", () => {
  test("syncs registered definitions idempotently", async () => {
    await syncRemoteScriptDefinitions();
    await syncRemoteScriptDefinitions();

    const definitions = await listDefinitions();
    const genericForms = definitions.filter((item) => item.scriptKey === "generic_form");
    const publishVideos = definitions.filter((item) => item.scriptKey === "publish_video");
    const registeredGenericForm = remoteScriptRegistry.get("generic_form");
    const registeredPublishVideo = remoteScriptRegistry.get("publish_video");

    expect(genericForms).toHaveLength(1);
    expect(publishVideos).toHaveLength(1);
    expect(registeredGenericForm).toBeDefined();
    expect(registeredPublishVideo).toEqual({
      name: "发布视频",
      description: "配置视频发布任务的外部接口、发布时间窗与执行闸口",
      configSchema: {
        type: "object",
        properties: {
          externalBaseUrl: {
            type: "string",
            description: "外部发布任务接口地址"
          },
          externalTokenEnv: {
            type: "string",
            description: "外部Token的环境变量名（不存Token值）"
          },
          publishTimeSlots: {
            type: "array",
            items: { type: "string" },
            maxItems: 8,
            description: "发布时间窗，HH:mm格式"
          },
          responseDelayMsMin: {
            type: "integer",
            minimum: 1,
            description: "响应时间闸口（毫秒）"
          },
          responseDelayMsMax: {
            type: "integer",
            minimum: 1,
            description: "响应时间闸口（毫秒）"
          },
          actionWaitMsMin: {
            type: "integer",
            minimum: 1,
            description: "等待时间闸口（毫秒）"
          },
          actionWaitMsMax: {
            type: "integer",
            minimum: 1,
            description: "等待时间闸口（毫秒）"
          },
          expectedTopicCount: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "话题数量校验"
          },
          requireCover: {
            type: "boolean",
            description: "无封面时跳过"
          },
          dailyLimitPerAccount: {
            type: "integer",
            minimum: 1,
            description: "每账号每日上限"
          },
          downloadDir: {
            type: "string",
            description: "设备端素材下载目录"
          }
        },
        required: [
          "externalBaseUrl",
          "externalTokenEnv",
          "publishTimeSlots",
          "responseDelayMsMin",
          "responseDelayMsMax",
          "actionWaitMsMin",
          "actionWaitMsMax",
          "expectedTopicCount"
        ]
      }
    });
    expect(genericForms[0]?.configSchema).toEqual(registeredGenericForm!.configSchema);
    expect(publishVideos[0]?.configSchema).toEqual(registeredPublishVideo!.configSchema);
  });
});

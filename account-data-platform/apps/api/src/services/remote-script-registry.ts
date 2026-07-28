import type { JsonSchemaLite } from "../lib/json-schema-lite";
import {
  listDefinitions,
  upsertDefinition
} from "../repositories/remote-script.repository";

export type RemoteScriptRegistryEntry = {
  name: string;
  description: string;
  configSchema: JsonSchemaLite;
};

const genericFormSchema: JsonSchemaLite = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
      description: "关键词"
    },
    titleTpl: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      description: "标题模板"
    },
    dailyLimit: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description: "每日上限"
    },
    mode: {
      type: "string",
      enum: ["immediate", "scheduled"],
      description: "发布方式"
    },
    enabled: {
      type: "boolean",
      description: "是否启用"
    }
  },
  required: ["keywords", "titleTpl"]
};

const publishVideoSchema: JsonSchemaLite = {
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
};

export const remoteScriptRegistry = new Map<string, RemoteScriptRegistryEntry>([
  [
    "generic_form",
    {
      name: "通用表单",
      description: "用于验证远程脚本动态配置与表单渲染链路",
      configSchema: genericFormSchema
    }
  ],
  [
    "publish_video",
    {
      name: "发布视频",
      description: "配置视频发布任务的外部接口、发布时间窗与执行闸口",
      configSchema: publishVideoSchema
    }
  ]
]);

export async function syncRemoteScriptDefinitions() {
  return Promise.all(
    [...remoteScriptRegistry.entries()].map(([scriptKey, definition]) =>
      upsertDefinition({
        scriptKey,
        name: definition.name,
        description: definition.description,
        configSchema: definition.configSchema,
        status: "ENABLED"
      }, "remote_script_registry")
    )
  );
}

export function listRemoteScriptDefinitions() {
  return listDefinitions();
}

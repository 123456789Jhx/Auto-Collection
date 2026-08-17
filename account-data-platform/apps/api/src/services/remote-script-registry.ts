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

type SourceModeVisibility = {
  field: "sourceMode";
  equals: "external_pull";
};

type ConditionalFieldSchema = JsonSchemaLite & {
  visibleWhen?: SourceModeVisibility;
};

type PublishVideoSchema = JsonSchemaLite & {
  allOf?: Array<{
    if: { properties: { sourceMode: { const: "external_pull" } }; required?: ["sourceMode"] };
    then: { required: string[] };
  }>;
};

const externalOnly = (schema: JsonSchemaLite): ConditionalFieldSchema => ({
  ...schema,
  visibleWhen: { field: "sourceMode", equals: "external_pull" }
});

const genericFormSchema: JsonSchemaLite = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
      description: "\u5173\u952e\u8bcd"
    },
    titleTpl: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      description: "\u6807\u9898\u6a21\u677f"
    },
    dailyLimit: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description: "\u6bcf\u65e5\u4e0a\u9650"
    },
    mode: {
      type: "string",
      enum: ["immediate", "scheduled"],
      description: "\u53d1\u5e03\u65b9\u5f0f"
    },
    enabled: {
      type: "boolean",
      description: "\u662f\u5426\u542f\u7528"
    }
  },
  required: ["keywords", "titleTpl"]
};

const publishVideoSchema: PublishVideoSchema = {
  type: "object",
  properties: {
    sourceMode: {
      type: "string",
      enum: ["direct_material", "external_pull"],
      description: "\u53d1\u5e03\u6765\u6e90\u65b9\u5f0f"
    },
    responseDelayMsMin: {
      type: "integer",
      minimum: 1,
      description: "响应延迟最小值（毫秒）"
    },
    responseDelayMsMax: {
      type: "integer",
      minimum: 1,
      description: "响应延迟最大值（毫秒）"
    },
    actionWaitMsMin: {
      type: "integer",
      minimum: 1,
      description: "操作等待最小值（毫秒）"
    },
    actionWaitMsMax: {
      type: "integer",
      minimum: 1,
      description: "操作等待最大值（毫秒）"
    },
    expectedTopicCount: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      description: "\u8bdd\u9898\u6570\u91cf\u6821\u9a8c"
    },
    requireCover: {
      type: "boolean",
      description: "\u662f\u5426\u5fc5\u987b\u6709\u5c01\u9762"
    },
    topicResolveTimeoutMinutes: {
      type: "integer",
      minimum: 1,
      maximum: 120,
      description: "\u8bdd\u9898\u8865\u5168\u7b49\u5f85\u8d85\u65f6\uff08\u5206\u949f\uff09"
    },
    downloadDir: {
      type: "string",
      description: "\u8bbe\u5907\u7aef\u7d20\u6750\u4e0b\u8f7d\u76ee\u5f55"
    },
    isDefault: {
      type: "boolean",
      description: "\u662f\u5426\u4e3a\u9ed8\u8ba4\u53d1\u5e03\u914d\u7f6e"
    },
    externalBaseUrl: externalOnly({
      type: "string",
      description: "\u5916\u90e8\u53d1\u5e03\u4efb\u52a1\u63a5\u53e3\u5730\u5740"
    }),
    externalTokenEnv: externalOnly({
      type: "string",
      description: "\u5916\u90e8 Token \u7684\u73af\u5883\u53d8\u91cf\u540d\uff08\u4e0d\u5b58 Token \u503c\uff09"
    }),
    publishTimeSlots: externalOnly({
      type: "array",
      items: { type: "string" },
      maxItems: 8,
      description: "\u65e7\u7248\u65f6\u95f4\u70b9\u517c\u5bb9\u5b57\u6bb5\uff08\u4e0d\u53c2\u4e0e\u65b0\u8c03\u5ea6\uff09"
    }),
    platforms: externalOnly({
      type: "array",
      items: { type: "string", enum: ["\u6296\u97f3", "\u89c6\u9891\u53f7"] },
      maxItems: 2,
      description: "\u65e7\u7248\u5e73\u53f0\u517c\u5bb9\u5b57\u6bb5\uff08\u65b0\u8c03\u5ea6\u4ee5\u8bbe\u5907\u8ba1\u5212\u4e3a\u51c6\uff09"
    })
  },
  required: [
    "responseDelayMsMin",
    "responseDelayMsMax",
    "actionWaitMsMin",
    "actionWaitMsMax",
    "expectedTopicCount"
  ],
  allOf: [{
    if: {
      properties: { sourceMode: { const: "external_pull" } },
      required: ["sourceMode"]
    },
    then: {
      required: ["externalBaseUrl", "externalTokenEnv"]
    }
  }]
};

export const remoteScriptRegistry = new Map<string, RemoteScriptRegistryEntry>([
  [
    "generic_form",
    {
      name: "\u901a\u7528\u8868\u5355",
      description: "\u7528\u4e8e\u9a8c\u8bc1\u8fdc\u7a0b\u811a\u672c\u52a8\u6001\u914d\u7f6e\u4e0e\u8868\u5355\u6e32\u67d3\u94fe\u8def",
      configSchema: genericFormSchema
    }
  ],
  [
    "publish_video",
    {
      name: "\u53d1\u5e03\u89c6\u9891",
      description: "\u914d\u7f6e\u89c6\u9891\u53d1\u5e03\u7684\u6267\u884c\u53c2\u6570\u4e0e\u5916\u90e8\u63a5\u53e3\u63a5\u5165",
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

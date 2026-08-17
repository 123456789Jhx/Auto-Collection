import { z } from "zod";

const MAX_CONFIG_PAYLOAD_BYTES = 16 * 1024;

const remoteScriptStatusSchema = z.enum(["ENABLED", "DISABLED"]);
const remoteScriptSourceModeSchema = z.enum(["direct_material", "external_pull"]);

const remoteScriptTimestampSchema = z.union([
  z.string().datetime(),
  z.date().transform((value) => value.toISOString())
]);

const remoteScriptAuditSchema = z.object({
  tenantId: z.string().min(1).max(64),
  createdAt: remoteScriptTimestampSchema,
  updatedAt: remoteScriptTimestampSchema,
  createdBy: z.string().min(1).max(64),
  updatedBy: z.string().min(1).max(64),
  deletedAt: remoteScriptTimestampSchema.nullable()
});

const remoteScriptConfigPayloadSchema = z
  .record(z.unknown())
  .superRefine((payload, context) => {
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "configPayload 必须可序列化为 JSON"
      });
      return;
    }

    if (new TextEncoder().encode(serialized).byteLength > MAX_CONFIG_PAYLOAD_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "configPayload 序列化后不能超过 16KB"
      });
    }
  });

export const remoteScriptDefinitionSchema = remoteScriptAuditSchema.extend({
  id: z.string().uuid(),
  scriptKey: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).nullable(),
  configSchema: z.record(z.unknown()),
  status: remoteScriptStatusSchema
}).strict();

export type RemoteScriptDefinition = z.infer<typeof remoteScriptDefinitionSchema>;

export const remoteScriptConfigSchema = remoteScriptAuditSchema.extend({
  id: z.string().uuid(),
  scriptKey: z.string().trim().min(1).max(64),
  configName: z.string().trim().min(1).max(100),
  configPayload: remoteScriptConfigPayloadSchema,
  revision: z.number().int().positive(),
  configHash: z.string().length(64),
  status: remoteScriptStatusSchema,
  remark: z.string().max(500).nullable()
}).strict();

export type RemoteScriptConfig = z.infer<typeof remoteScriptConfigSchema>;

export const createRemoteScriptConfigSchema = z.object({
  scriptKey: z.string().trim().min(1).max(64),
  configName: z.string().trim().min(1).max(100),
  configPayload: remoteScriptConfigPayloadSchema,
  status: remoteScriptStatusSchema.default("ENABLED"),
  remark: z.string().max(500).nullable().optional()
}).strict();

export type CreateRemoteScriptConfigPayload = z.infer<typeof createRemoteScriptConfigSchema>;

export const updateRemoteScriptConfigSchema = z.object({
  configName: z.string().trim().min(1).max(100).optional(),
  configPayload: remoteScriptConfigPayloadSchema.optional(),
  status: remoteScriptStatusSchema.optional(),
  remark: z.string().max(500).nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "至少提供一个需要更新的字段"
});

export type UpdateRemoteScriptConfigPayload = z.infer<typeof updateRemoteScriptConfigSchema>;

export const remoteScriptConfigListQuerySchema = z.object({
  scriptKey: z.string().trim().min(1).max(64).optional(),
  status: remoteScriptStatusSchema.optional(),
  keyword: z.string().trim().min(1).max(100).optional(),
  sourceMode: remoteScriptSourceModeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
}).strict();

export type RemoteScriptConfigListQuery = z.infer<typeof remoteScriptConfigListQuerySchema>;

export const remoteScriptDeviceBindingPayloadSchema = z.object({
  deviceCode: z.string().trim().min(1).max(64),
  priority: z.number().int().min(1).max(1000).default(100)
}).strict();

export type RemoteScriptDeviceBindingPayload = z.infer<typeof remoteScriptDeviceBindingPayloadSchema>;

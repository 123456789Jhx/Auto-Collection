import type {
  CreateRemoteScriptConfigPayload,
  RemoteScriptDeviceBindingPayload,
  RemoteScriptConfigListQuery,
  UpdateRemoteScriptConfigPayload
} from "@pkg/types";
import {
  createConfig,
  findEnabledConfigForDevice,
  findConfigById,
  findDefinitionByKey,
  getBindingCounts,
  listConfigBindings,
  listConfigs,
  saveConfigBinding,
  softDeleteConfig,
  softDeleteConfigBinding,
  updateConfig
} from "../repositories/remote-script.repository";
import { findDeviceByCode } from "../repositories/device.repository";
import { createScriptConfigUpdatedCommand } from "./command.service";
import {
  validateJsonSchemaLite,
  type JsonSchemaLite
} from "../lib/json-schema-lite";
import { publishVideoConfigSchema } from "./publish-config";

export type RemoteScriptErrorCode =
  | "NOT_FOUND"
  | "CONFIG_NAME_CONFLICT"
  | "SCRIPT_TYPE_DISABLED"
  | "PAYLOAD_SCHEMA_MISMATCH";

export class RemoteScriptServiceError extends Error {
  constructor(
    code: RemoteScriptErrorCode,
    readonly userMessage: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(code);
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  );
}

function rethrowConfigWriteError(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw new RemoteScriptServiceError(
      "CONFIG_NAME_CONFLICT",
      "同一脚本类型下已存在同名配置"
    );
  }
  throw error;
}

async function requireEnabledDefinition(scriptKey: string) {
  const definition = await findDefinitionByKey(scriptKey);
  if (!definition) {
    throw new RemoteScriptServiceError(
      "NOT_FOUND",
      "远程脚本类型不存在",
      { scriptKey }
    );
  }
  if (definition.status !== "ENABLED") {
    throw new RemoteScriptServiceError(
      "SCRIPT_TYPE_DISABLED",
      "远程脚本类型已停用",
      { scriptKey }
    );
  }
  return definition;
}

function assertPayloadMatchesSchema(
  configSchema: Record<string, unknown>,
  configPayload: Record<string, unknown>
) {
  const result = validateJsonSchemaLite(
    configSchema as JsonSchemaLite,
    configPayload
  );
  if (!result.success) {
    throw new RemoteScriptServiceError(
      "PAYLOAD_SCHEMA_MISMATCH",
      "配置内容不符合脚本类型约束",
      { errors: result.errors }
    );
  }
}

const publishVideoExternalFieldNames = [
  "externalBaseUrl",
  "externalTokenEnv",
  "publishTimeSlots",
  "platforms"
] as const;
const sensitiveConfigFieldPattern = /token|secret|password|authorization|api[-_]?key/i;
const environmentVariableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function throwPayloadSchemaMismatch(errors: string[]): never {
  throw new RemoteScriptServiceError(
    "PAYLOAD_SCHEMA_MISMATCH",
    "配置内容不符合脚本类型约束",
    { errors }
  );
}

function findSensitiveConfigFields(
  value: unknown,
  path: string[] = []
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSensitiveConfigFields(item, [...path, String(index)]));
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nestedValue]) => {
    const keyPath = [...path, key];
    const isAllowedTokenEnvironmentName = key === "externalTokenEnv" && path.length === 0;
    const currentField = sensitiveConfigFieldPattern.test(key) && !isAllowedTokenEnvironmentName
      ? [keyPath.join(".")]
      : [];
    return [...currentField, ...findSensitiveConfigFields(nestedValue, keyPath)];
  });
}

export function normalizePublishVideoConfigPayload(
  configPayload: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveFields = findSensitiveConfigFields(configPayload);
  if (sensitiveFields.length > 0) {
    throwPayloadSchemaMismatch(sensitiveFields.map((field) => field + ": 不允许保存敏感凭据字段"));
  }

  if (configPayload.sourceMode === "direct_material") {
    const forbiddenFields = publishVideoExternalFieldNames.filter((field) =>
      Object.hasOwn(configPayload, field)
    );
    if (forbiddenFields.length > 0) {
      throwPayloadSchemaMismatch(forbiddenFields.map((field) => field + ": direct_material 不允许该字段"));
    }
  }

  const parsed = publishVideoConfigSchema.safeParse(configPayload);
  if (!parsed.success) {
    throwPayloadSchemaMismatch(parsed.error.issues.map((issue) =>
      (issue.path.join(".") || "configPayload") + ": " + issue.message
    ));
  }

  if (
    parsed.data.sourceMode === "external_pull" &&
    !environmentVariableNamePattern.test(parsed.data.externalTokenEnv)
  ) {
    throwPayloadSchemaMismatch(["externalTokenEnv: 必须是环境变量名"]);
  }

  return parsed.data as Record<string, unknown>;
}

function validateAndNormalizeConfigPayload(
  scriptKey: string,
  configSchema: Record<string, unknown>,
  configPayload: Record<string, unknown>
) {
  const normalizedPayload = scriptKey === "publish_video"
    ? normalizePublishVideoConfigPayload(configPayload)
    : configPayload;
  assertPayloadMatchesSchema(configSchema, normalizedPayload);
  return normalizedPayload;
}

export async function getRemoteScriptConfigs(query: RemoteScriptConfigListQuery) {
  const page = await listConfigs(query);
  const counts = await getBindingCounts(page.data.map((item) => item.id));
  return {
    ...page,
    data: page.data.map((item) => ({ ...item, bindingCount: counts.get(item.id) ?? 0 }))
  };
}

export async function getRemoteScriptConfig(id: string) {
  const savedConfig = await findConfigById(id);
  if (!savedConfig) {
    throw new RemoteScriptServiceError("NOT_FOUND", "远程脚本配置不存在", { id });
  }
  return savedConfig;
}

export async function createRemoteScriptConfig(
  payload: CreateRemoteScriptConfigPayload,
  actor: string
) {
  const definition = await requireEnabledDefinition(payload.scriptKey);
  const configPayload = validateAndNormalizeConfigPayload(
    payload.scriptKey,
    definition.configSchema,
    payload.configPayload
  );
  try {
    return await createConfig({ ...payload, configPayload }, actor);
  } catch (error) {
    rethrowConfigWriteError(error);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableJson(nestedValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function queueConfigUpdateNotification(
  savedConfig: ConfigForNotification,
  bindings: BindingForNotification[],
  eventKey: string,
  actor: string
) {
  void notifyConfigUpdated(savedConfig, bindings, eventKey, actor).catch((error) => {
    console.warn(JSON.stringify({
      scope: "remote-script-config",
      event: "notification_failed",
      configId: savedConfig.id,
      bindingCount: bindings.length,
      error: String(error instanceof Error ? error.message : error)
    }));
  });
}

export async function updateRemoteScriptConfig(
  id: string,
  payload: UpdateRemoteScriptConfigPayload,
  actor: string
) {
  const current = await getRemoteScriptConfig(id);
  const definition = await requireEnabledDefinition(current.scriptKey);
  const currentPayload = current.configPayload;
  const configPayload = payload.configPayload === undefined
    ? undefined
    : validateAndNormalizeConfigPayload(
      current.scriptKey,
      definition.configSchema,
      payload.configPayload
    );
  const nextPayload = configPayload ?? currentPayload;
  const unchanged = current.configName === (payload.configName ?? current.configName)
    && current.status === (payload.status ?? current.status)
    && current.remark === (payload.remark === undefined ? current.remark : payload.remark)
    && stableJson(currentPayload) === stableJson(nextPayload);
  const bindings = await listConfigBindings(current.id);
  if (unchanged) {
    return { ...current, bindingCount: bindings.length, notificationQueued: false };
  }
  try {
    const updated = await updateConfig(
      id,
      configPayload === undefined ? payload : { ...payload, configPayload },
      actor
    );
    if (!updated) {
      throw new RemoteScriptServiceError("NOT_FOUND", "远程脚本配置不存在", { id });
    }
    queueConfigUpdateNotification(updated, bindings, "c", actor);
    return { ...updated, bindingCount: bindings.length, notificationQueued: bindings.length > 0 };
  } catch (error) {
    if (error instanceof RemoteScriptServiceError) {
      throw error;
    }
    rethrowConfigWriteError(error);
  }
}

export async function deleteRemoteScriptConfig(id: string, actor: string) {
  const current = await getRemoteScriptConfig(id);
  const bindings = await listConfigBindings(id);
  const deleted = await softDeleteConfig(id, actor);
  if (!deleted) {
    throw new RemoteScriptServiceError("NOT_FOUND", "远程脚本配置不存在", { id });
  }
  await notifyConfigUpdated(current, bindings, `d:${deleted.updatedAt.getTime()}`, actor);
  return deleted;
}

type ConfigForNotification = {
  id: string;
  scriptKey: string;
  revision: number;
  configHash: string;
};

type BindingForNotification = {
  deviceId: string;
};

async function notifyConfigUpdated(
  savedConfig: ConfigForNotification,
  bindings: BindingForNotification[],
  eventKey: string,
  actor: string
) {
  return Promise.all(bindings.map((binding) => createScriptConfigUpdatedCommand({
    deviceId: binding.deviceId,
    configId: savedConfig.id,
    scriptKey: savedConfig.scriptKey,
    revision: savedConfig.revision,
    configHash: savedConfig.configHash,
    eventKey,
    actor
  })));
}

export async function getRemoteScriptBindings(configId: string) {
  await getRemoteScriptConfig(configId);
  return listConfigBindings(configId);
}

export async function bindRemoteScriptConfig(
  configId: string,
  payload: RemoteScriptDeviceBindingPayload,
  actor: string
) {
  const [savedConfig, device] = await Promise.all([
    getRemoteScriptConfig(configId),
    findDeviceByCode(payload.deviceCode)
  ]);
  if (!device) {
    throw new RemoteScriptServiceError("NOT_FOUND", "设备不存在", { deviceCode: payload.deviceCode });
  }
  const binding = await saveConfigBinding(configId, device.id, payload.priority, actor);
  const [delivery] = await notifyConfigUpdated(
    savedConfig,
    [{ deviceId: device.id }],
    `b:${binding.updatedAt.getTime()}`,
    actor
  );
  return { ...binding, deviceCode: device.deviceCode, deviceName: device.deviceName, delivery };
}

export async function unbindRemoteScriptConfig(configId: string, deviceCode: string, actor: string) {
  const [savedConfig, device] = await Promise.all([
    getRemoteScriptConfig(configId),
    findDeviceByCode(deviceCode)
  ]);
  if (!device) {
    throw new RemoteScriptServiceError("NOT_FOUND", "设备不存在", { deviceCode });
  }
  const deleted = await softDeleteConfigBinding(configId, device.id, actor);
  if (!deleted) {
    throw new RemoteScriptServiceError("NOT_FOUND", "远程脚本设备绑定不存在", { configId, deviceCode });
  }
  const [delivery] = await notifyConfigUpdated(
    savedConfig,
    [{ deviceId: device.id }],
    `u:${deleted.updatedAt.getTime()}`,
    actor
  );
  return { binding: deleted, delivery };
}

export async function getRemoteScriptConfigForDevice(deviceCode: string, scriptKey: string) {
  const device = await findDeviceByCode(deviceCode);
  if (!device) {
    throw new RemoteScriptServiceError("NOT_FOUND", "设备不存在", { deviceCode });
  }
  return findEnabledConfigForDevice(device.id, scriptKey);
}

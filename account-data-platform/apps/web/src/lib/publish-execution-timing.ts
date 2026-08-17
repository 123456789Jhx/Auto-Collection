const publishTimingLabels = {
  responseDelayMsMin: "响应延迟最小值",
  responseDelayMsMax: "响应延迟最大值",
  actionWaitMsMin: "动作等待最小值",
  actionWaitMsMax: "动作等待最大值"
} as const;

export const publishTimingFieldKeys = Object.keys(publishTimingLabels) as Array<keyof typeof publishTimingLabels>;

type PublishTimingFieldKey = keyof typeof publishTimingLabels;
type PublishTimingPayload = Record<string, unknown>;

type PublishTimingValidation = {
  field: PublishTimingFieldKey;
  message: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function transformPublishTiming<T extends PublishTimingPayload>(
  scriptKey: string | undefined,
  payload: T,
  transform: (value: number) => number
): T {
  const nextPayload: PublishTimingPayload = { ...payload };
  if (scriptKey !== "publish_video") return nextPayload as T;
  for (const fieldKey of publishTimingFieldKeys) {
    const value = nextPayload[fieldKey];
    if (isFiniteNumber(value)) nextPayload[fieldKey] = transform(value);
  }
  return nextPayload as T;
}

export function publishTimingPayloadToSeconds<T extends PublishTimingPayload>(scriptKey: string | undefined, payload: T): T {
  return transformPublishTiming(scriptKey, payload, (value) => value / 1000);
}

export function publishTimingPayloadToMilliseconds<T extends PublishTimingPayload>(scriptKey: string | undefined, payload: T): T {
  return transformPublishTiming(scriptKey, payload, (value) => Math.round(value * 1000));
}

export function publishTimingSchemaForUi(schema?: Record<string, unknown>) {
  if (!schema || typeof schema.properties !== "object" || !schema.properties || Array.isArray(schema.properties)) {
    return schema;
  }
  const properties = { ...(schema.properties as Record<string, unknown>) };
  for (const fieldKey of publishTimingFieldKeys) {
    const fieldSchema = properties[fieldKey];
    if (!fieldSchema || typeof fieldSchema !== "object" || Array.isArray(fieldSchema)) continue;
    properties[fieldKey] = {
      ...(fieldSchema as Record<string, unknown>),
      type: "number",
      minimum: 0,
      description: publishTimingLabels[fieldKey] + "（秒）"
    };
  }
  return { ...schema, properties };
}

export function validatePublishTimingSeconds(payload: PublishTimingPayload): PublishTimingValidation | null {
  for (const fieldKey of publishTimingFieldKeys) {
    const value = payload[fieldKey];
    if (isFiniteNumber(value) && value < 0) {
      return { field: fieldKey, message: publishTimingLabels[fieldKey] + "不能小于 0 秒" };
    }
  }
  const ranges: Array<[PublishTimingFieldKey, PublishTimingFieldKey]> = [
    ["responseDelayMsMin", "responseDelayMsMax"],
    ["actionWaitMsMin", "actionWaitMsMax"]
  ];
  for (const [minField, maxField] of ranges) {
    const minValue = payload[minField];
    const maxValue = payload[maxField];
    if (isFiniteNumber(minValue) && isFiniteNumber(maxValue) && maxValue < minValue) {
      return { field: maxField, message: publishTimingLabels[maxField] + "不能小于最小值" };
    }
  }
  return null;
}

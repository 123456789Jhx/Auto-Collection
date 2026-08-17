export type DynamicFieldType = "string" | "integer" | "number" | "boolean" | "array";

export type DynamicVisibleWhen = {
  field: string;
  equals: string | number | boolean;
};

export type DynamicFieldSchema = {
  type: DynamicFieldType;
  description?: string;
  enum?: Array<string | number>;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  items?: { type: "string" };
  visibleWhen?: DynamicVisibleWhen;
};

export type DynamicObjectSchema = {
  type: "object";
  properties: Record<string, DynamicFieldSchema>;
  required: string[];
};

export type DynamicFieldProps = {
  fieldKey: string;
  schema: DynamicFieldSchema;
  required: boolean;
  namePrefix: string;
};

const fieldTypes = new Set<DynamicFieldType>([
  "string",
  "integer",
  "number",
  "boolean",
  "array"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeVisibleWhen(value: unknown): DynamicVisibleWhen | undefined {
  if (!isRecord(value) || typeof value.field !== "string" || !value.field.trim()) return undefined;
  if (typeof value.equals !== "string" && typeof value.equals !== "number" && typeof value.equals !== "boolean") {
    return undefined;
  }
  return { field: value.field, equals: value.equals };
}

function normalizeFieldSchema(value: unknown): DynamicFieldSchema | null {
  if (!isRecord(value) || typeof value.type !== "string" || !fieldTypes.has(value.type as DynamicFieldType)) {
    return null;
  }
  return {
    ...(value as DynamicFieldSchema),
    visibleWhen: normalizeVisibleWhen(value.visibleWhen)
  };
}

export function normalizeObjectSchema(value?: Record<string, unknown>): DynamicObjectSchema | null {
  if (!value || value.type !== "object" || !isRecord(value.properties)) return null;
  const properties: Record<string, DynamicFieldSchema> = {};
  for (const [fieldKey, fieldSchema] of Object.entries(value.properties)) {
    const normalized = normalizeFieldSchema(fieldSchema);
    if (normalized) properties[fieldKey] = normalized;
  }
  return {
    type: "object",
    properties,
    required: Array.isArray(value.required)
      ? value.required.filter((item): item is string => typeof item === "string")
      : []
  };
}

export function fieldLabel(fieldKey: string, schema: DynamicFieldSchema) {
  return schema.description?.trim() || fieldKey;
}

export function isFieldVisible(schema: DynamicFieldSchema, values: Record<string, unknown>) {
  const condition = schema.visibleWhen;
  return !condition || Object.is(values[condition.field], condition.equals);
}

export function removeInactiveConditionalValues(
  schema: DynamicObjectSchema,
  values: Record<string, unknown>
) {
  let nextValues = values;
  for (const [fieldKey, fieldSchema] of Object.entries(schema.properties)) {
    const condition = fieldSchema.visibleWhen;
    if (!condition || values[condition.field] === undefined || isFieldVisible(fieldSchema, values)) continue;
    if (!Object.prototype.hasOwnProperty.call(nextValues, fieldKey)) continue;
    if (nextValues === values) nextValues = { ...values };
    delete nextValues[fieldKey];
  }
  return nextValues;
}

export type JsonSchemaLiteType =
  | "object"
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "array";

export type JsonSchemaLite = {
  type: JsonSchemaLiteType;
  properties?: Record<string, JsonSchemaLite>;
  items?: JsonSchemaLite;
  required?: string[];
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  description?: string;
};

export type JsonSchemaLiteValidationResult = {
  success: boolean;
  errors: string[];
};

const typeLabels: Record<JsonSchemaLiteType, string> = {
  object: "对象",
  string: "字符串",
  integer: "整数",
  number: "数字",
  boolean: "布尔值",
  array: "数组"
};

function pathLabel(path: string) {
  return path || "配置";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesType(type: JsonSchemaLiteType, value: unknown) {
  if (type === "object") return isObject(value);
  if (type === "string") return typeof value === "string";
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  return Array.isArray(value);
}

function enumIncludes(values: unknown[], value: unknown) {
  const serialized = JSON.stringify(value);
  return values.some((candidate) => JSON.stringify(candidate) === serialized);
}

function validateString(
  schema: JsonSchemaLite,
  value: string,
  path: string,
  errors: string[]
) {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${pathLabel(path)}: 字符长度不能少于 ${schema.minLength}`);
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push(`${pathLabel(path)}: 字符长度不能超过 ${schema.maxLength}`);
  }
}

function validateNumber(
  schema: JsonSchemaLite,
  value: number,
  path: string,
  errors: string[]
) {
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${pathLabel(path)}: 数值不能小于 ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push(`${pathLabel(path)}: 数值不能大于 ${schema.maximum}`);
  }
}

function validateArray(
  schema: JsonSchemaLite,
  value: unknown[],
  path: string,
  errors: string[]
) {
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push(`${pathLabel(path)}: 数组元素不能超过 ${schema.maxItems} 个`);
  }
  if (schema.items) {
    value.forEach((item, index) => validateNode(schema.items!, item, `${path}[${index}]`, errors));
  }
}

function validateObject(
  schema: JsonSchemaLite,
  value: Record<string, unknown>,
  path: string,
  errors: string[]
) {
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) {
      errors.push(`${path ? `${path}.` : ""}${key}: 必填字段缺失`);
    }
  }
  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) {
      continue;
    }
    validateNode(propertySchema, value[key], `${path ? `${path}.` : ""}${key}`, errors);
  }
}

function validateNode(
  schema: JsonSchemaLite,
  value: unknown,
  path: string,
  errors: string[]
) {
  if (!matchesType(schema.type, value)) {
    errors.push(`${pathLabel(path)}: 类型应为${typeLabels[schema.type]}`);
    return;
  }
  if (schema.enum && !enumIncludes(schema.enum, value)) {
    errors.push(`${pathLabel(path)}: 不在允许的枚举值范围内`);
  }
  if (schema.type === "string") {
    validateString(schema, value as string, path, errors);
  } else if (schema.type === "integer" || schema.type === "number") {
    validateNumber(schema, value as number, path, errors);
  } else if (schema.type === "array") {
    validateArray(schema, value as unknown[], path, errors);
  } else if (schema.type === "object") {
    validateObject(schema, value as Record<string, unknown>, path, errors);
  }
}

export function validateJsonSchemaLite(
  schema: JsonSchemaLite,
  value: unknown
): JsonSchemaLiteValidationResult {
  const errors: string[] = [];
  validateNode(schema, value, "", errors);
  return { success: errors.length === 0, errors };
}

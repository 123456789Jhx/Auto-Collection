import type { Rule } from "antd/es/form";
import { fieldLabel, type DynamicFieldSchema } from "./schema";

function isMissing(value: unknown) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function validateType(label: string, schema: DynamicFieldSchema, value: unknown) {
  if (schema.type === "string" && typeof value !== "string") throw new Error(`${label}必须是文本`);
  if ((schema.type === "integer" || schema.type === "number") && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${label}必须是数字`);
  }
  if (schema.type === "integer" && !Number.isInteger(value)) throw new Error(`${label}必须是整数`);
  if (schema.type === "boolean" && typeof value !== "boolean") throw new Error(`${label}必须是开关值`);
  if (schema.type === "array" && !Array.isArray(value)) throw new Error(`${label}必须是列表`);
}

function validateBounds(label: string, schema: DynamicFieldSchema, value: unknown) {
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) {
    throw new Error(`${label}至少填写 ${schema.minLength} 个字符`);
  }
  if (typeof value === "string" && schema.maxLength !== undefined && value.length > schema.maxLength) {
    throw new Error(`${label}最多填写 ${schema.maxLength} 个字符`);
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    throw new Error(`${label}不能小于 ${schema.minimum}`);
  }
  if (typeof value === "number" && schema.maximum !== undefined && value > schema.maximum) {
    throw new Error(`${label}不能大于 ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.maxItems !== undefined && value.length > schema.maxItems) {
    throw new Error(`${label}最多填写 ${schema.maxItems} 项`);
  }
}

const publishTimeSlotPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizePublishTimeSlots(value: string[]) {
  return [...new Set(value.map((slot) => slot.trim()).filter(Boolean))].sort();
}

export function validatePublishTimeSlots(value: unknown) {
  if (!Array.isArray(value) || value.some((slot) => typeof slot !== "string" || !publishTimeSlotPattern.test(slot.trim()))) {
    throw new Error("发布时间窗必须为 HH:mm，例如 11:00");
  }
}

function validateValues(label: string, schema: DynamicFieldSchema, value: unknown) {
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    throw new Error(`${label}不在可选范围内`);
  }
  if (schema.type === "array" && Array.isArray(value) && !value.every((item: unknown) => typeof item === "string")) {
    throw new Error(`${label}只能包含文本`);
  }
}

export function fieldRules(fieldKey: string, schema: DynamicFieldSchema, required: boolean): Rule[] {
  const label = fieldLabel(fieldKey, schema);
  const rules: Rule[] = required ? [{ required: true, message: `${label}为必填项` }] : [];
  rules.push({
    validator: async (_, value: unknown) => {
      if (isMissing(value)) return;
      validateType(label, schema, value);
      validateBounds(label, schema, value);
      validateValues(label, schema, value);
      if (fieldKey === "publishTimeSlots") validatePublishTimeSlots(value);
    }
  });
  return rules;
}

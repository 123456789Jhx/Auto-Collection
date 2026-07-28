import { describe, expect, test } from "bun:test";
import { validateJsonSchemaLite, type JsonSchemaLite } from "./json-schema-lite";

const schema: JsonSchemaLite = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 2,
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

function validPayload() {
  return {
    keywords: ["玉米"],
    titleTpl: "今日{keyword}",
    dailyLimit: 10,
    mode: "scheduled",
    enabled: true
  };
}

describe("validateJsonSchemaLite", () => {
  test("rejects missing required fields", () => {
    const result = validateJsonSchemaLite(schema, { ...validPayload(), keywords: undefined });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("keywords: 必填字段缺失");
  });

  test("rejects values with the wrong type", () => {
    const result = validateJsonSchemaLite(schema, { ...validPayload(), dailyLimit: "10" });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("dailyLimit: 类型应为整数");
  });

  test("rejects enum values outside the allowed set", () => {
    const result = validateJsonSchemaLite(schema, { ...validPayload(), mode: "manual" });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("mode: 不在允许的枚举值范围内");
  });

  test("rejects arrays larger than maxItems", () => {
    const result = validateJsonSchemaLite(schema, {
      ...validPayload(),
      keywords: ["玉米", "水稻", "小麦"]
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("keywords: 数组元素不能超过 2 个");
  });

  test("accepts a valid payload", () => {
    expect(validateJsonSchemaLite(schema, validPayload())).toEqual({
      success: true,
      errors: []
    });
  });
});

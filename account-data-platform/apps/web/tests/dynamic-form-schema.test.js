import { describe, expect, test } from "bun:test";
import {
  isFieldVisible,
  normalizeObjectSchema,
  removeInactiveConditionalValues
} from "../src/components/dynamic-form/schema";
import {
  normalizePublishTimeSlots,
  validatePublishTimeSlots
} from "../src/components/dynamic-form/field-rules";

const schema = normalizeObjectSchema({
  type: "object",
  properties: {
    sourceMode: { type: "string", enum: ["direct_material", "external_pull"] },
    externalBaseUrl: {
      type: "string",
      visibleWhen: { field: "sourceMode", equals: "external_pull" }
    },
    externalTokenEnv: {
      type: "string",
      visibleWhen: { field: "sourceMode", equals: "external_pull" }
    },
    publishTimeSlots: {
      type: "array",
      items: { type: "string" },
      visibleWhen: { field: "sourceMode", equals: "external_pull" }
    },
    platforms: {
      type: "array",
      items: { type: "string" },
      visibleWhen: { field: "sourceMode", equals: "external_pull" }
    },
    expectedTopicCount: { type: "integer" }
  },
  required: []
});

if (!schema) throw new Error("expected a valid schema");

describe("dynamic form conditions", () => {
  test("shows external fields only for external_pull", () => {
    expect(isFieldVisible(schema.properties.externalBaseUrl, { sourceMode: "external_pull" })).toBe(true);
    expect(isFieldVisible(schema.properties.externalBaseUrl, { sourceMode: "direct_material" })).toBe(false);
  });

  test("clears all external values after switching to direct_material", () => {
    const values = {
      sourceMode: "direct_material",
      externalBaseUrl: "https://api.example.com",
      externalTokenEnv: "WECOM_PUBLISH_TOKEN",
      publishTimeSlots: ["08:00"],
      platforms: ["抖音"],
      expectedTopicCount: 5
    };

    expect(removeInactiveConditionalValues(schema, values)).toEqual({
      sourceMode: "direct_material",
      expectedTopicCount: 5
    });
  });

  test("preserves existing external settings until a source mode is selected", () => {
    const values = { externalBaseUrl: "https://api.example.com" };
    expect(removeInactiveConditionalValues(schema, values)).toBe(values);
  });
});

test("validates and normalizes external publish time slots in HH:mm format", () => {
  expect(normalizePublishTimeSlots(["11:00", "08:30", "11:00", " 08:30 "])).toEqual(["08:30", "11:00"]);
  expect(() => validatePublishTimeSlots(["08:30", "11:00"])).not.toThrow();
  expect(() => validatePublishTimeSlots(["8:30"])).toThrow("发布时间窗必须为 HH:mm，例如 11:00");
});

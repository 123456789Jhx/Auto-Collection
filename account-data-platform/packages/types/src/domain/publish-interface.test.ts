import { describe, expect, test } from "bun:test";
import {
  interfacePublishConfirmRunPayloadSchema,
  interfacePublishPhoneResultPayloadSchema,
  interfacePublishRunConfigSchema,
  interfacePublishRunStatusSchema,
  interfacePublishSlotStatusSchema,
  interfacePublishStopRunPayloadSchema
} from "./publish-interface";

const configId = "11111111-1111-4111-8111-111111111111";

function config(overrides: Record<string, unknown> = {}) {
  return {
    configId,
    morningPublishTime: "09:00",
    afternoonPublishTime: "15:00",
    maxConcurrentPublishing: 3,
    ...overrides
  };
}

describe("interface publish contracts", () => {
  test("accepts exact publish times only inside the fixed windows", () => {
    for (const morningPublishTime of ["06:00", "11:59"]) {
      expect(interfacePublishRunConfigSchema.safeParse(config({ morningPublishTime })).success).toBeTrue();
    }
    for (const morningPublishTime of ["05:59", "12:00", "13:00"]) {
      expect(interfacePublishRunConfigSchema.safeParse(config({ morningPublishTime })).success).toBeFalse();
    }
    for (const afternoonPublishTime of ["13:00", "23:59"]) {
      expect(interfacePublishRunConfigSchema.safeParse(config({ afternoonPublishTime })).success).toBeTrue();
    }
    for (const afternoonPublishTime of ["12:59", "00:00", "24:00"]) {
      expect(interfacePublishRunConfigSchema.safeParse(config({ afternoonPublishTime })).success).toBeFalse();
    }
  });

  test("rejects editable windows, extra platforms, and non-positive capacity", () => {
    expect(interfacePublishRunConfigSchema.safeParse(config({ morningWindowStart: "05:00" })).success).toBeFalse();
    expect(interfacePublishRunConfigSchema.safeParse(config({ platform: "WECHAT_CHANNELS" })).success).toBeFalse();
    expect(interfacePublishRunConfigSchema.safeParse(config({ maxConcurrentPublishing: 0 })).success).toBeFalse();
    expect(interfacePublishRunConfigSchema.safeParse(config({ maxConcurrentPublishing: 50 })).success).toBeTrue();
  });

  test("defaults the confirmed first-version runtime values", () => {
    const parsed = interfacePublishRunConfigSchema.parse(config());
    expect(parsed.timezone).toBe("Asia/Shanghai");
    expect(parsed.noMaterialRetryMinutes).toBe(10);
    expect(parsed.platform).toBe("DOUYIN");
  });

  test("defines the confirmed run and slot states", () => {
    for (const status of ["DRAFT", "CHECKING_BINDINGS", "WAITING_USER_CONFIRMATION", "SCHEDULED", "RUNNING", "STOPPING", "STOPPED"] as const) {
      expect(interfacePublishRunStatusSchema.parse(status)).toBe(status);
    }
    for (const status of ["CLAIM_RESULT_UNKNOWN", "PUBLISHED", "FAILED", "RESULT_UNKNOWN", "WINDOW_EXPIRED"] as const) {
      expect(interfacePublishSlotStatusSchema.parse(status)).toBe(status);
    }
  });

  test("accepts per-run skips and requires explicit stop risk confirmation", () => {
    const bindingId = "22222222-2222-4222-8222-222222222222";
    expect(interfacePublishConfirmRunPayloadSchema.parse({ skippedBindingIds: [bindingId] })).toEqual({
      skippedBindingIds: [bindingId]
    });
    expect(interfacePublishStopRunPayloadSchema.parse({ confirmedDailyFallbackRisk: true })).toEqual({
      confirmedDailyFallbackRisk: true
    });
  });

  test("accepts the mature phone success value and the local three-state model", () => {
    const base = { deviceId: "device-01", deviceToken: "token-01" };
    for (const status of ["SUCCEEDED", "PUBLISHED", "FAILED", "RESULT_UNKNOWN", "MATERIAL_INVALID", "PUBLISH_BUSY"]) {
      expect(interfacePublishPhoneResultPayloadSchema.safeParse({ ...base, status }).success).toBeTrue();
    }
  });
});

import { describe, expect, test } from "bun:test";
import type { InterfacePublishRunConfig } from "@pkg/types";
import { validateManualRunStart } from "./publish-interface-start-time";

const config: InterfacePublishRunConfig = {
  configId: "11111111-1111-4111-8111-111111111111",
  morningPublishTime: "09:00",
  afternoonPublishTime: "15:00",
  maxConcurrentPublishing: 3,
  noMaterialRetryMinutes: 10,
  timezone: "Asia/Shanghai",
  platform: "DOUYIN"
};

describe("manual interface publish run start time", () => {
  test("allows starting before the morning publish time", () => {
    expect(validateManualRunStart(config, new Date("2026-08-06T00:00:00.000Z"))).toMatchObject({
      valid: true,
      businessDate: "2026-08-06",
      morning: "WAITING",
      afternoon: "WAITING"
    });
  });

  test("rejects a passed morning time while the morning window is still open", () => {
    expect(validateManualRunStart(config, new Date("2026-08-06T02:00:00.000Z"))).toEqual({
      valid: false,
      businessDate: "2026-08-06",
      code: "MORNING_PUBLISH_TIME_PASSED",
      message: "请重新设置晚于当前时间且早于 12:00 的上午发布时间"
    });
  });

  test("marks morning missed at noon and keeps a future afternoon opportunity", () => {
    expect(validateManualRunStart(config, new Date("2026-08-06T04:00:00.000Z"))).toMatchObject({
      valid: true,
      businessDate: "2026-08-06",
      morning: "MISSED",
      afternoon: "WAITING"
    });
  });

  test("rejects a passed afternoon time before the day ends", () => {
    expect(validateManualRunStart(config, new Date("2026-08-06T08:00:00.000Z"))).toEqual({
      valid: false,
      businessDate: "2026-08-06",
      code: "AFTERNOON_PUBLISH_TIME_PASSED",
      message: "请重新设置晚于当前时间且早于次日 00:00 的下午发布时间"
    });
  });

  test("uses the Shanghai business date across the UTC date boundary", () => {
    expect(validateManualRunStart(config, new Date("2026-08-05T16:30:00.000Z"))).toMatchObject({
      businessDate: "2026-08-06"
    });
  });
});

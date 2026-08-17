import { describe, expect, test } from "bun:test";
import type { InterfacePublishRunConfig, InterfacePublishSlot } from "@pkg/types";
import { resolveBusinessClock, resolveDueSlots } from "./publish-interface-time.service";

const boundaryConfig: InterfacePublishRunConfig = {
  configId: "11111111-1111-4111-8111-111111111111",
  morningPublishTime: "06:00",
  afternoonPublishTime: "13:00",
  maxConcurrentPublishing: 3,
  noMaterialRetryMinutes: 10,
  timezone: "Asia/Shanghai",
  platform: "DOUYIN"
};

function shanghaiTime(value: string) {
  return new Date(`2026-08-06T${value}:00+08:00`);
}

describe("interface publish business clock", () => {
  test("resolves fixed-window boundaries without using the server timezone", () => {
    const cases: Array<[string, InterfacePublishSlot[]]> = [
      ["05:59", []],
      ["06:00", ["MORNING"]],
      ["11:59", ["MORNING"]],
      ["12:00", []],
      ["12:59", []],
      ["13:00", ["AFTERNOON"]],
      ["23:59", ["AFTERNOON"]],
      ["00:00", []]
    ];
    for (const [time, expected] of cases) {
      expect(resolveDueSlots(boundaryConfig, shanghaiTime(time))).toEqual(expected);
    }
  });

  test("returns the Shanghai business date and minute of day", () => {
    expect(resolveBusinessClock(new Date("2026-08-05T16:00:00.000Z"), "Asia/Shanghai")).toEqual({
      businessDate: "2026-08-06",
      minuteOfDay: 0
    });
  });

  test("waits for the configured exact publish time inside each fixed window", () => {
    const config = { ...boundaryConfig, morningPublishTime: "09:00", afternoonPublishTime: "15:00" };
    expect(resolveDueSlots(config, shanghaiTime("08:59"))).toEqual([]);
    expect(resolveDueSlots(config, shanghaiTime("09:00"))).toEqual(["MORNING"]);
    expect(resolveDueSlots(config, shanghaiTime("14:59"))).toEqual([]);
    expect(resolveDueSlots(config, shanghaiTime("15:00"))).toEqual(["AFTERNOON"]);
  });
});

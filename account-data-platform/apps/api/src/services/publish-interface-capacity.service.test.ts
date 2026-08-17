import { describe, expect, test } from "bun:test";
import { calculatePublishingCapacity } from "./publish-interface-capacity.service";

describe("interface publish capacity", () => {
  test("clamps free slots to the configured publishing limit", () => {
    expect(calculatePublishingCapacity(3, ["PUBLISHING"])).toEqual({
      activePublishingCount: 1,
      freeSlots: 2
    });
    expect(calculatePublishingCapacity(2, ["PUBLISHING", "DISPATCHED", "PUBLISHING"])).toEqual({
      activePublishingCount: 3,
      freeSlots: 0
    });
  });

  test("does not count interface requests or no-material slots as phone publishing", () => {
    expect(calculatePublishingCapacity(3, [
      "ELIGIBLE",
      "NO_MATERIAL",
      "CLAIMED",
      "DISPATCHED",
      "PUBLISHING"
    ])).toEqual({
      activePublishingCount: 2,
      freeSlots: 1
    });
  });
});

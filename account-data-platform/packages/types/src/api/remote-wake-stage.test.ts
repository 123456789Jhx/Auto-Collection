import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("./remote-wake-stage.ts", import.meta.url));

test("remote wake stages describe only the Liaoyuan Xinghuo launch sequence", async () => {
  expect(existsSync(contractPath)).toBe(true);

  const contract = await import("./remote-wake-stage");
  expect(Array.from(contract.REMOTE_WAKE_STAGES)).toEqual([
    "CREATED",
    "DISPATCHED",
    "DEVICE_RECEIVED",
    "SCREEN_ON",
    "KEYGUARD_DISMISSED",
    "TASK_CLEARED",
    "APP_LAUNCHED",
    "UI_READY"
  ]);
  expect(contract.remoteWakeStageSchema.safeParse("DOUYIN_STARTED").success).toBe(false);
});

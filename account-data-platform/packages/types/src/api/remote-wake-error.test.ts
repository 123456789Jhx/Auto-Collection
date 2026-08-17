import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("./remote-wake-error.ts", import.meta.url));

test("remote wake error codes identify the failed infrastructure step", async () => {
  expect(existsSync(contractPath)).toBe(true);

  const contract = await import("./remote-wake-error");
  expect(Array.from(contract.REMOTE_WAKE_ERROR_CODES)).toEqual([
    "PUSH_CHANNEL_UNAVAILABLE",
    "PUSH_SEND_FAILED",
    "COMMAND_EXPIRED",
    "SCREEN_WAKE_FAILED",
    "KEYGUARD_DISMISS_FAILED",
    "TASK_CLEAR_FAILED",
    "APP_LAUNCH_FAILED",
    "UI_READY_TIMEOUT",
    "COMMAND_TIMED_OUT",
    "ACK_REJECTED"
  ]);
  expect(contract.remoteWakeErrorCodeSchema.safeParse("DOUYIN_LAUNCH_FAILED").success).toBe(false);
});

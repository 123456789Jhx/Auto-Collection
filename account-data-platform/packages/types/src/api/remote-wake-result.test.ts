import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("./remote-wake-result.ts", import.meta.url));

test("remote wake has explicit success failure and timeout results", async () => {
  expect(existsSync(contractPath)).toBe(true);

  const contract = await import("./remote-wake-result");
  expect(Array.from(contract.REMOTE_WAKE_RESULT_STATUSES)).toEqual([
    "SUCCEEDED",
    "FAILED",
    "TIMED_OUT"
  ]);
  expect(contract.remoteWakeResultStatusSchema.safeParse("DONE").success).toBe(false);
});

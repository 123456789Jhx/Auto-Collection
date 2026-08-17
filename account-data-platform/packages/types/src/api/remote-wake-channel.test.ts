import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("./remote-wake-channel.ts", import.meta.url));

test("remote wake supports only agent polling and Xiaomi push channels", async () => {
  expect(existsSync(contractPath)).toBe(true);

  const contract = await import("./remote-wake-channel");
  expect(Array.from(contract.REMOTE_WAKE_CHANNELS)).toEqual(["AGENT_POLL", "XIAOMI_PUSH"]);
  expect(contract.remoteWakeChannelSchema.safeParse("AGENT_POLL").success).toBe(true);
  expect(contract.remoteWakeChannelSchema.safeParse("XIAOMI_PUSH").success).toBe(true);
  expect(contract.remoteWakeChannelSchema.safeParse("ADB").success).toBe(false);
});

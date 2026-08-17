import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("./remote-wake.ts", import.meta.url));

test("remote wake declares OPEN_AGENT_APP as its only command type", async () => {
  expect(existsSync(contractPath)).toBe(true);

  const contract = await import("./remote-wake");
  expect(contract.REMOTE_WAKE_COMMAND_TYPE).toBe("OPEN_AGENT_APP");
  expect(contract.remoteWakeCommandTypeSchema.parse("OPEN_AGENT_APP")).toBe("OPEN_AGENT_APP");
});

test("remote wake command type rejects existing app restart commands", async () => {
  expect(existsSync(contractPath)).toBe(true);

  const contract = await import("./remote-wake");
  expect(contract.remoteWakeCommandTypeSchema.safeParse("RESTART_APP").success).toBe(false);
  expect(contract.remoteWakeCommandTypeSchema.safeParse("RESTART_AGENT").success).toBe(false);
});

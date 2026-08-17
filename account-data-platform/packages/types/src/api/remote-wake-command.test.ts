import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("./remote-wake-command.ts", import.meta.url));

test("remote wake command requires identity and expiry fields", async () => {
  expect(existsSync(contractPath)).toBe(true);

  const { remoteWakeCommandSchema } = await import("./remote-wake-command");
  const command = remoteWakeCommandSchema.parse({
    commandType: "OPEN_AGENT_APP",
    commandId: "00000000-0000-4000-8000-000000000001",
    deviceId: "device-mi8-01",
    issuedAt: "2026-08-10T10:00:00.000Z",
    expiresAt: "2026-08-10T10:01:00.000Z"
  });

  expect(command.commandType).toBe("OPEN_AGENT_APP");
  expect(command.deviceId).toBe("device-mi8-01");
});

test("remote wake command rejects expired or foreign commands", async () => {
  expect(existsSync(contractPath)).toBe(true);

  const { remoteWakeCommandSchema } = await import("./remote-wake-command");
  const base = {
    commandId: "00000000-0000-4000-8000-000000000001",
    deviceId: "device-mi8-01",
    issuedAt: "2026-08-10T10:00:00.000Z",
    expiresAt: "2026-08-10T09:59:59.000Z"
  };

  expect(remoteWakeCommandSchema.safeParse({ ...base, commandType: "OPEN_AGENT_APP" }).success).toBe(false);
  expect(remoteWakeCommandSchema.safeParse({ ...base, commandType: "RESTART_APP" }).success).toBe(false);
});

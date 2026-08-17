import { expect, test } from "bun:test";
import { remoteWakeChannelSchema } from "./remote-wake-channel";
import { remoteWakeCommandSchema } from "./remote-wake-command";
import { remoteWakeErrorCodeSchema } from "./remote-wake-error";
import { remoteWakeResultStatusSchema } from "./remote-wake-result";
import { remoteWakeStageSchema } from "./remote-wake-stage";

test("remote wake contracts validate one command lifecycle without Douyin fields", () => {
  const command = remoteWakeCommandSchema.parse({
    commandType: "OPEN_AGENT_APP",
    commandId: "00000000-0000-4000-8000-000000000021",
    deviceId: "mi8-work-order-device",
    issuedAt: "2026-08-10T10:00:00.000Z",
    expiresAt: "2026-08-10T10:01:00.000Z"
  });

  expect(command.commandType).toBe("OPEN_AGENT_APP");
  expect(remoteWakeChannelSchema.parse("XIAOMI_PUSH")).toBe("XIAOMI_PUSH");
  expect(remoteWakeStageSchema.parse("UI_READY")).toBe("UI_READY");
  expect(remoteWakeResultStatusSchema.parse("SUCCEEDED")).toBe("SUCCEEDED");
  expect(remoteWakeErrorCodeSchema.safeParse("DOUYIN_SCRIPT_FAILED").success).toBe(false);
  expect(Object.keys(command)).not.toContain("douyin");
});

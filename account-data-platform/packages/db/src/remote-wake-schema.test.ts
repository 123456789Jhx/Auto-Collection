import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

const pushSchemaPath = fileURLToPath(new URL("./remote-wake-push-channel-schema.ts", import.meta.url));
const attemptSchemaPath = fileURLToPath(new URL("./remote-wake-attempt-schema.ts", import.meta.url));

test("remote wake push channel schema binds one provider registration to a device", async () => {
  expect(existsSync(pushSchemaPath)).toBe(true);

  const { remoteWakePushChannels } = await import("./remote-wake-push-channel-schema");
  expect(getTableName(remoteWakePushChannels)).toBe("device_remote_wake_push_channels");
  expect(remoteWakePushChannels.deviceId.name).toBe("device_id");
  expect(remoteWakePushChannels.registrationId.name).toBe("registration_id");
  expect(remoteWakePushChannels.lastRegisteredAt.name).toBe("last_registered_at");
  const unique = getTableConfig(remoteWakePushChannels).indexes.find(
    (index) => index.config.name === "uniq_remote_wake_push_channel_device_provider"
  );
  expect(unique?.config.unique).toBe(true);
});

test("remote wake attempt schema stores diagnostics for every command phase", async () => {
  expect(existsSync(attemptSchemaPath)).toBe(true);

  const { remoteWakeAttempts } = await import("./remote-wake-attempt-schema");
  expect(getTableName(remoteWakeAttempts)).toBe("remote_wake_attempts");
  expect(remoteWakeAttempts.commandId.name).toBe("command_id");
  expect(remoteWakeAttempts.stage.name).toBe("stage");
  expect(remoteWakeAttempts.resultStatus.name).toBe("result_status");
  expect(remoteWakeAttempts.errorCode.name).toBe("error_code");
  expect(remoteWakeAttempts.ackTokenHash.name).toBe("ack_token_hash");
});

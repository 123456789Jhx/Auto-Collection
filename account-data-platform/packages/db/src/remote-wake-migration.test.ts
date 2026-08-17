import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(
  new URL("./migrations/0032_remote_wake_foundation.sql", import.meta.url)
);

test("remote wake migration creates both isolated foundation tables", () => {
  expect(existsSync(migrationPath)).toBe(true);

  const sql = readFileSync(migrationPath, "utf8");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS \"device_remote_wake_push_channels\"");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS \"remote_wake_attempts\"");
  expect(sql).toContain("REFERENCES \"collector_devices\"(\"id\")");
  expect(sql).toContain("REFERENCES \"mobile_commands\"(\"id\")");
  expect(sql).toContain("uniq_remote_wake_push_channel_device_provider");
  expect(sql).toContain("uniq_remote_wake_attempt_command");
});

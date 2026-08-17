import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(
  new URL("./migrations/0033_device_recovery_sessions.sql", import.meta.url)
);

test("device recovery migration creates sessions and idempotent stage events", () => {
  expect(existsSync(migrationPath)).toBe(true);

  const sql = readFileSync(migrationPath, "utf8");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS \"device_recovery_sessions\"");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS \"device_recovery_stage_events\"");
  expect(sql).toContain("REFERENCES \"collector_devices\"(\"id\")");
  expect(sql).toContain("REFERENCES \"mobile_commands\"(\"id\")");
  expect(sql).toContain("REFERENCES \"device_recovery_sessions\"(\"id\")");
  expect(sql).toContain("uniq_device_recovery_stage_event_key");
  expect(sql).toContain("idx_device_recovery_session_device_started");
  expect(sql).toContain("idx_device_recovery_stage_event_session_occurred");
});

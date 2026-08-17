import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("./migrations/0034_agent_base_status.sql", import.meta.url));

test("Agent base migration adds independent base telemetry and desired Agent state", () => {
  expect(existsSync(migrationPath)).toBe(true);
  const sql = readFileSync(migrationPath, "utf8");

  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "base_status"');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "base_last_heartbeat_at"');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "screen_state"');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "desired_agent_state"');
});

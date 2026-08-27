import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("./migrations/0035_mobile_command_executor_claim.sql", import.meta.url));
const exitBackfillMigrationPath = fileURLToPath(new URL("./migrations/0038_exit_agent_app_executor_backfill.sql", import.meta.url));
const videoStopMigrationPath = fileURLToPath(new URL("./migrations/0040_video_warmup_stop_claim.sql", import.meta.url));

test("mobile command claim migration separates executors and enforces one active channel", () => {
  expect(existsSync(migrationPath)).toBe(true);
  const sql = readFileSync(migrationPath, "utf8");

  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "executor_type"');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "claimed_at"');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "claim_token"');
  expect(sql).toContain('uniq_mobile_commands_active_executor_channel');
  expect(sql).toContain("WHERE \"status\" IN ('CLAIMED', 'RUNNING')");
  expect(sql).toContain('"command_type" IN (\'START_AGENT\', \'STOP_AGENT\', \'OPEN_AGENT_APP\')');
});

test("backfills historical EXIT_AGENT_APP commands into the BASE executor", () => {
  expect(existsSync(exitBackfillMigrationPath)).toBe(true);
  const sql = readFileSync(exitBackfillMigrationPath, "utf8");
  expect(sql).toContain('SET "executor_type" = \'BASE\'');
  expect(sql).toContain('WHERE "command_type" = \'EXIT_AGENT_APP\'');
});

test("allows VIDEO_WARMUP_STOP alongside an active Agent run", () => {
  expect(existsSync(videoStopMigrationPath)).toBe(true);
  const sql = readFileSync(videoStopMigrationPath, "utf8");
  expect(sql).toContain('"command_type" NOT IN (\'ACCOUNT_WARMUP_STOP\', \'VIDEO_WARMUP_STOP\')');
});

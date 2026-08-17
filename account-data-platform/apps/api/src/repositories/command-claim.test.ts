import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repositoryPath = fileURLToPath(new URL("./command.repository.ts", import.meta.url));

test("command polling atomically claims one pending command in an isolated executor channel", () => {
  const source = readFileSync(repositoryPath, "utf8");

  expect(source).toContain("pg_advisory_xact_lock");
  expect(source).toContain("command.executor_type = ${executorType}");
  expect(source).toContain("command.status = 'PENDING'");
  expect(source).toContain("active.status IN ('CLAIMED', 'RUNNING')");
  expect(source).toContain("FOR UPDATE SKIP LOCKED");
  expect(source).toContain("LIMIT 1");
  expect(source).toContain("SET status = 'CLAIMED'");
  expect(source).not.toContain('inArray(mobileCommands.status, ["PENDING", "FETCHED"]),\n        isNull(mobileCommands.deletedAt),\n        isNull(collectorDevices.deletedAt)');
});

test("stale native-base claims time out quickly without shortening business Agent commands", () => {
  const source = readFileSync(repositoryPath, "utf8");

  expect(source).toContain("command_base_timeout");
  expect(source).toContain("executor_type = 'BASE'");
  expect(source).toContain("claimed_at <= now() - interval '45 seconds'");
  expect(source).toContain("expires_at <= now()");
});

test("allows a matching warmup stop through while its run is active", () => {
  const source = readFileSync(repositoryPath, "utf8");

  expect(source).toContain("command.command_type = 'ACCOUNT_WARMUP_STOP'");
  expect(source).toContain("run.command_type = 'ACCOUNT_WARMUP_RUN'");
  expect(source).toContain("run.status IN ('CLAIMED', 'RUNNING')");
  expect(source).toContain("OR command.command_type = 'ACCOUNT_WARMUP_STOP'");
});

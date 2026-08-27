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

  expect(source).toContain("command.command_type IN ('ACCOUNT_WARMUP_STOP', 'VIDEO_WARMUP_STOP')");
  expect(source).toContain("run.command_type = 'ACCOUNT_WARMUP_RUN'");
  expect(source).toContain("run.status IN ('CLAIMED', 'RUNNING')");
  expect(source).toContain("OR command.command_type IN ('ACCOUNT_WARMUP_STOP', 'VIDEO_WARMUP_STOP')");
});

test("allows a matching video warmup stop through while its run is active", () => {
  const source = readFileSync(repositoryPath, "utf8");

  expect(source).toContain("command.command_type IN ('ACCOUNT_WARMUP_STOP', 'VIDEO_WARMUP_STOP')");
  expect(source).toContain("active.command_type NOT IN ('ACCOUNT_WARMUP_STOP', 'VIDEO_WARMUP_STOP')");
  expect(source).toContain("active_stop.command_type IN ('ACCOUNT_WARMUP_STOP', 'VIDEO_WARMUP_STOP')");
});

test("does not reuse an expired idempotent stop command", () => {
  const source = readFileSync(fileURLToPath(new URL("../services/command.service.ts", import.meta.url)), "utf8");

  expect(source).toContain("existing.expiresAt");
  expect(source).toContain("existing.expiresAt > new Date()");
});

test("matches video warmup stop to its active run by batch and feature key", () => {
  const source = readFileSync(repositoryPath, "utf8");

  expect(source).toContain("command.command_type = 'VIDEO_WARMUP_STOP'");
  expect(source).toContain("run.payload_json ->> 'featureKey' = command.payload_json ->> 'featureKey'");
});

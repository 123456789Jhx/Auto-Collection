import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@pkg/db/schema";
import { config } from "../config";
import { createCommentTimingCommandClaimer, createCommentTimingRunningAck } from "./comment-timing-command.repository";

// Connection-local temporary tables: no production rows or schema are modified.
const client = postgres(config.databaseUrl, { max: 1 });
const connection = drizzle(client, { schema });
const claim = createCommentTimingCommandClaimer(connection, "timing-test");
const acknowledgeRunning = createCommentTimingRunningAck(connection, "timing-test");
const deviceId = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  await client`SET search_path TO pg_temp`;
  await client`CREATE TEMP TABLE collector_devices (
    id uuid primary key, tenant_id text, enabled boolean, agent_lifecycle_state text,
    polling_enabled boolean, status text, deleted_at timestamptz)`;
  await client`CREATE TEMP TABLE mobile_commands (
    id uuid primary key, tenant_id text, device_id uuid, executor_type text, command_type text,
    status text, payload_json jsonb, assignment_id uuid, command_sequence int, result_json jsonb,
    claim_token text, claimed_at timestamptz, fetched_at timestamptz, acknowledged_at timestamptz,
    issued_at timestamptz default now(), expires_at timestamptz default (now() + interval '1 hour'),
    created_at timestamptz default now(), updated_at timestamptz, updated_by text, deleted_at timestamptz)`;
  await client`CREATE UNIQUE INDEX active_executor_guard ON mobile_commands(tenant_id,device_id,executor_type)
    WHERE status IN ('CLAIMED','RUNNING') AND command_type NOT IN ('ACCOUNT_WARMUP_STOP','VIDEO_WARMUP_STOP') AND deleted_at IS NULL`;
  await client`INSERT INTO collector_devices VALUES (${deviceId},'timing-test',true,'RUNNING',true,'online',null)`;
});
beforeEach(async () => { await client`TRUNCATE mobile_commands`; });
afterAll(async () => { await client.end(); });

async function add(commandType: string, status: string, payload: Record<string, unknown>, tenant = "timing-test") {
  const id = crypto.randomUUID();
  await client`INSERT INTO mobile_commands (id,tenant_id,device_id,executor_type,command_type,status,payload_json)
    VALUES (${id},${tenant},${deviceId},'AGENT',${commandType},${status},${JSON.stringify(payload)}::jsonb)`;
  return id;
}

test("refresh is fetched during comment run without breaching the single-worker index", async () => {
  const run = await add("ACCOUNT_WARMUP_RUN", "RUNNING", { featureKey: "isolated_live_comment_entry" });
  const refresh = await add("REFRESH_CONFIG", "PENDING", { reason: "comment_action_timing_updated" });
  const result = await claim(deviceId);
  expect(result?.id).toBe(refresh);
  expect(result?.status).toBe("FETCHED");
  expect((await client`SELECT status FROM mobile_commands WHERE id=${run}`)[0].status).toBe("RUNNING");
  expect(await claim(deviceId)).toBeNull();
});

test("another business and ordinary refresh never use the comment control lane", async () => {
  await add("ACCOUNT_WARMUP_RUN", "RUNNING", { featureKey: "video_warmup" });
  await add("REFRESH_CONFIG", "PENDING", { reason: "comment_action_timing_updated" });
  expect(await claim(deviceId)).toBeNull();
  await client`TRUNCATE mobile_commands`;
  await add("ACCOUNT_WARMUP_RUN", "RUNNING", { featureKey: "isolated_live_comment_entry" });
  await add("REFRESH_CONFIG", "PENDING", { reason: "device_task_config_updated" });
  expect(await claim(deviceId)).toBeNull();
});

test("pending stop takes priority and other tenant commands are not claimed", async () => {
  await add("ACCOUNT_WARMUP_RUN", "RUNNING", { featureKey: "isolated_live_comment_entry" });
  await add("REFRESH_CONFIG", "PENDING", { reason: "comment_action_timing_copied" });
  await add("ACCOUNT_WARMUP_STOP", "PENDING", {});
  expect(await claim(deviceId)).toBeNull();
  await client`DELETE FROM mobile_commands WHERE command_type='ACCOUNT_WARMUP_STOP'`;
  await client`UPDATE mobile_commands SET tenant_id='another' WHERE command_type='REFRESH_CONFIG'`;
  expect(await claim(deviceId)).toBeNull();
});

test("a fetched refresh blocks a second until its bounded lease expires", async () => {
  await add("ACCOUNT_WARMUP_RUN", "RUNNING", { featureKey: "isolated_live_comment_entry" });
  const first = await add("REFRESH_CONFIG", "PENDING", { reason: "comment_action_timing_updated" });
  expect((await claim(deviceId))?.id).toBe(first);
  const second = await add("REFRESH_CONFIG", "PENDING", { reason: "comment_action_timing_copied" });
  expect(await claim(deviceId)).toBeNull();
  await client`UPDATE mobile_commands SET fetched_at=now()-interval '61 seconds' WHERE id=${first}`;
  expect((await claim(deviceId))?.id).toBe(second);
  expect((await client`SELECT status FROM mobile_commands WHERE id=${first}`)[0].status).toBe("TIMED_OUT");
});

test("the existing phone RUNNING acknowledgement keeps a refresh outside the business worker index", async () => {
  const run = await add("ACCOUNT_WARMUP_RUN", "RUNNING", { featureKey: "isolated_live_comment_entry" });
  const refresh = await add("REFRESH_CONFIG", "PENDING", { reason: "comment_action_timing_updated" });
  await claim(deviceId);
  const acknowledged = await acknowledgeRunning(refresh, deviceId, "RUNNING");
  expect(acknowledged?.command.status).toBe("FETCHED");
  expect(acknowledged?.idempotent).toBe(true);
  expect((await client`SELECT status FROM mobile_commands WHERE id=${run}`)[0].status).toBe("RUNNING");
  expect(await acknowledgeRunning(refresh, "00000000-0000-4000-8000-000000000002", "RUNNING")).toBeNull();
  expect(await acknowledgeRunning(refresh, deviceId, "DONE")).toBeNull();
});

test("RUNNING acknowledgement after the business finishes does not extend the refresh lease", async () => {
  const run = await add("ACCOUNT_WARMUP_RUN", "RUNNING", { featureKey: "isolated_live_comment_entry" });
  const refresh = await add("REFRESH_CONFIG", "PENDING", { reason: "comment_action_timing_copied" });
  await claim(deviceId);
  await client`UPDATE mobile_commands SET status='DONE' WHERE id=${run}`;
  await client`UPDATE mobile_commands SET fetched_at=now()-interval '61 seconds' WHERE id=${refresh}`;
  expect((await acknowledgeRunning(refresh, deviceId, "RUNNING"))?.command.status).toBe("FETCHED");
  await claim(deviceId);
  expect((await client`SELECT status FROM mobile_commands WHERE id=${refresh}`)[0].status).toBe("TIMED_OUT");
});

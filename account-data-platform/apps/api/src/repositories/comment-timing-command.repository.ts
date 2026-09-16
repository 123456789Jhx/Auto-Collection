import type { DbClient } from "@pkg/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import { db } from "./db";

type FetchedTimingCommand = {
  id: string; assignmentId: string | null; commandSequence: number | null;
  commandType: string; payloadJson: Record<string, unknown> | null; status: string;
  issuedAt: Date; expiresAt: Date | null; claimToken: string; updatedAt: Date;
};

// Configuration refresh is synchronous in the existing Agent control loop.
// FETCHED reserves this control message; it never creates a second business worker.
// Keep the single CLAIMED/RUNNING worker index and the normal command queue intact.
export function createCommentTimingCommandClaimer(database: Pick<DbClient, "transaction">, tenantId: string) {
  return async function claim(deviceId: string): Promise<FetchedTimingCommand | null> {
    return database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${`${deviceId}:AGENT`}))`);
      await transaction.execute(sql`
        UPDATE mobile_commands SET status='TIMED_OUT', acknowledged_at=now(), updated_at=now(),
          updated_by='comment_timing_control_timeout', result_json='{"reason":"config_refresh_ack_timeout"}'::jsonb
        WHERE tenant_id=${tenantId} AND device_id=${deviceId} AND executor_type='AGENT'
          AND command_type='REFRESH_CONFIG' AND status='FETCHED' AND deleted_at IS NULL
          AND payload_json->>'reason' IN ('comment_action_timing_updated','comment_action_timing_copied')
          AND (fetched_at < now()-interval '60 seconds' OR expires_at <= now())
      `);
      const rows = await transaction.execute<FetchedTimingCommand>(sql`
        WITH candidate AS (
          SELECT command.id FROM mobile_commands command
          JOIN collector_devices device ON device.id=command.device_id AND device.tenant_id=command.tenant_id
          WHERE command.tenant_id=${tenantId} AND command.device_id=${deviceId}
            AND device.enabled=true AND device.polling_enabled=true AND device.agent_lifecycle_state='RUNNING'
            AND device.status<>'stopped' AND device.deleted_at IS NULL
            AND command.executor_type='AGENT' AND command.command_type='REFRESH_CONFIG'
            AND command.payload_json->>'reason' IN ('comment_action_timing_updated','comment_action_timing_copied')
            AND command.status='PENDING' AND command.deleted_at IS NULL AND command.expires_at>now()
            AND EXISTS (
              SELECT 1 FROM mobile_commands run WHERE run.tenant_id=command.tenant_id
                AND run.device_id=command.device_id AND run.executor_type='AGENT'
                AND run.command_type='ACCOUNT_WARMUP_RUN' AND run.status IN ('CLAIMED','RUNNING')
                AND run.payload_json->>'featureKey'='isolated_live_comment_entry'
                AND run.deleted_at IS NULL AND run.expires_at>now()
            )
            AND NOT EXISTS (
              SELECT 1 FROM mobile_commands active WHERE active.tenant_id=command.tenant_id
                AND active.device_id=command.device_id AND active.executor_type='AGENT'
                AND active.deleted_at IS NULL AND active.expires_at>now()
                AND (
                  (active.status IN ('FETCHED','CLAIMED','RUNNING') AND NOT (
                    active.command_type='ACCOUNT_WARMUP_RUN'
                    AND coalesce(active.payload_json->>'featureKey','')='isolated_live_comment_entry'
                  )) OR (active.status='PENDING' AND active.command_type IN ('ACCOUNT_WARMUP_STOP','VIDEO_WARMUP_STOP'))
                )
            )
          ORDER BY command.created_at,command.id FOR UPDATE OF command SKIP LOCKED LIMIT 1
        )
        UPDATE mobile_commands command SET status='FETCHED', fetched_at=now(), claim_token=${randomUUID()},
          updated_at=now(),updated_by='comment_timing_control'
        FROM candidate WHERE command.id=candidate.id
        RETURNING command.id,command.assignment_id AS "assignmentId",command.command_sequence AS "commandSequence",
          command.command_type AS "commandType",command.payload_json AS "payloadJson",command.status,
          command.issued_at AS "issuedAt",command.expires_at AS "expiresAt",command.claim_token AS "claimToken",command.updated_at AS "updatedAt"
      `);
      return rows[0] ?? null;
    });
  };
}

export const claimCommentTimingRefresh = createCommentTimingCommandClaimer(db, config.tenantId);

// Existing APKs ACK every polled command as RUNNING before dispatching it.
// Treat that transport ACK as a no-op for this FETCHED control message. Promoting
// it to RUNNING would violate the active business worker index, even though the
// refresh handler itself is synchronous. DONE/FAILED still use the normal ACK path.
export function createCommentTimingRunningAck(database: Pick<DbClient, "transaction">, tenantId: string) {
  return async function acknowledge(commandId: string, deviceId: string, status: string) {
    if (status !== "RUNNING" && status !== "CLAIMED") return null;
    return database.transaction(async (transaction) => {
      const rows = await transaction.execute<FetchedTimingCommand>(sql`
        SELECT command.id, command.assignment_id AS "assignmentId", command.command_sequence AS "commandSequence",
          command.command_type AS "commandType", command.payload_json AS "payloadJson", command.status,
          command.issued_at AS "issuedAt", command.expires_at AS "expiresAt", command.claim_token AS "claimToken", command.updated_at AS "updatedAt"
        FROM mobile_commands command
        WHERE command.id=${commandId} AND command.device_id=${deviceId} AND command.tenant_id=${tenantId}
          AND command.executor_type='AGENT' AND command.command_type='REFRESH_CONFIG'
          AND command.payload_json->>'reason' IN ('comment_action_timing_updated','comment_action_timing_copied')
          AND command.status='FETCHED' AND command.updated_by='comment_timing_control'
          AND command.claim_token IS NOT NULL AND command.deleted_at IS NULL
        FOR UPDATE
      `);
      return rows[0] ? { command: rows[0], assignment: null, event: null, idempotent: true } : null;
    });
  };
}

export const acknowledgeCommentTimingRunning = createCommentTimingRunningAck(db, config.tenantId);

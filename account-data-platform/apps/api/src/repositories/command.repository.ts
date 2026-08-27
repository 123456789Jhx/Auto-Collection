import { mobileCommands } from "@pkg/db/schema";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import type { CommandExecutor } from "../services/command-executor";
import { executorForCommandType } from "../services/command-executor";
import { db } from "./db";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ExitAgentAppConflictError extends Error {
  readonly details: Record<string, unknown>;

  constructor(details: Record<string, unknown>) {
    super("EXIT_AGENT_APP_ACTIVE_CONFLICT");
    this.details = details;
  }
}

export async function createMobileCommand(values: typeof mobileCommands.$inferInsert) {
  const [command] = await db.insert(mobileCommands).values({
    ...values,
    executorType: executorForCommandType(values.commandType)
  }).returning();
  return command;
}

export async function finalizePendingVideoWarmupRun(deviceId: string, batchId: string) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${config.tenantId}), hashtext(${`${deviceId}:BASE`}))`);
    const now = new Date();
    const rows = await transaction
      .update(mobileCommands)
      .set({ status: "IGNORED", resultJson: { status: "STOPPED", reason: "stop_requested_before_claim" }, acknowledgedAt: now, updatedAt: now, updatedBy: "admin" })
      .where(and(eq(mobileCommands.tenantId, config.tenantId), eq(mobileCommands.deviceId, deviceId), eq(mobileCommands.commandType, "ACCOUNT_WARMUP_RUN"), eq(mobileCommands.status, "PENDING"), sql`${mobileCommands.payloadJson} ->> 'featureKey' = 'video_warmup'`, sql`${mobileCommands.payloadJson} ->> 'batchId' = ${batchId}`, isNull(mobileCommands.deletedAt)))
      .returning();
    return rows[0] ?? null;
  });
}

export async function findMobileCommandByIdempotencyKey(idempotencyKey: string) {
  const [command] = await db
    .select()
    .from(mobileCommands)
    .where(and(
      eq(mobileCommands.tenantId, config.tenantId),
      eq(mobileCommands.idempotencyKey, idempotencyKey),
      isNull(mobileCommands.deletedAt)
    ))
    .limit(1);
  return command ?? null;
}

export async function findBaseCommandForAck(commandId: string, deviceId: string, claimToken: string) {
  const [command] = await db
    .select()
    .from(mobileCommands)
    .where(and(
      eq(mobileCommands.tenantId, config.tenantId),
      eq(mobileCommands.id, commandId),
      eq(mobileCommands.deviceId, deviceId),
      eq(mobileCommands.executorType, "BASE"),
      eq(mobileCommands.claimToken, claimToken),
      isNull(mobileCommands.deletedAt)
    ))
    .limit(1);
  return command ?? null;
}

function lockScreenRequested(payload: Record<string, unknown> | null | undefined) {
  return payload?.lockScreen === true;
}

export async function createExitAgentAppCommandAtomic(values: typeof mobileCommands.$inferInsert) {
  const deviceId = values.deviceId;
  if (!deviceId) {
    throw new Error("EXIT_AGENT_APP_DEVICE_REQUIRED");
  }

  const findByKey = async (transaction: DatabaseTransaction) => {
    if (!values.idempotencyKey) return null;
    const [existing] = await transaction
      .select()
      .from(mobileCommands)
      .where(and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(mobileCommands.idempotencyKey, values.idempotencyKey),
        isNull(mobileCommands.deletedAt)
      ))
      .limit(1);
    return existing ?? null;
  };

  const reuseByKey = (existing: typeof mobileCommands.$inferSelect) => {
    if (existing.deviceId !== deviceId || existing.commandType !== "EXIT_AGENT_APP" || existing.executorType !== "BASE") {
      throw new ExitAgentAppConflictError({
        reason: "IDEMPOTENCY_KEY_ALREADY_USED",
        existingCommandId: existing.id
      });
    }
    return { command: existing, outcome: "idempotent" as const };
  };

  return db.transaction(async (transaction: DatabaseTransaction) => {
    const existingBeforeLock = await findByKey(transaction);
    if (existingBeforeLock) return reuseByKey(existingBeforeLock);

    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${config.tenantId}), hashtext(${`${deviceId}:EXIT_AGENT_APP`}))`
    );

    const existingAfterLock = await findByKey(transaction);
    if (existingAfterLock) return reuseByKey(existingAfterLock);

    const now = new Date();
    const activeRows = await transaction
      .select()
      .from(mobileCommands)
      .where(and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(mobileCommands.deviceId, deviceId),
        eq(mobileCommands.commandType, "EXIT_AGENT_APP"),
        inArray(mobileCommands.status, ["PENDING", "FETCHED", "CLAIMED", "RUNNING"]),
        isNull(mobileCommands.deletedAt),
        or(isNull(mobileCommands.expiresAt), gt(mobileCommands.expiresAt, now))
      ))
      .orderBy(mobileCommands.createdAt, mobileCommands.id)
      .for("update");
    const active = activeRows[0];

    if (active) {
      const wrongExecutor = activeRows.find((candidate) => candidate.executorType !== "BASE");
      if (wrongExecutor) {
        throw new ExitAgentAppConflictError({
          reason: "ACTIVE_EXIT_COMMAND_WRONG_EXECUTOR",
          existingCommandId: wrongExecutor.id,
          existingExecutorType: wrongExecutor.executorType
        });
      }
      const requestedLockScreen = lockScreenRequested(values.payloadJson);
      const conflictingActive = activeRows.find((candidate) =>
        lockScreenRequested(candidate.payloadJson) !== requestedLockScreen
      );
      if (conflictingActive) {
        throw new ExitAgentAppConflictError({
          existingCommandId: conflictingActive.id,
          existingLockScreen: lockScreenRequested(conflictingActive.payloadJson),
          requestedLockScreen
        });
      }
      return { command: active, outcome: "active_reused" as const };
    }

    const insertValues = {
      ...values,
      tenantId: config.tenantId,
      deviceId,
      commandType: "EXIT_AGENT_APP",
      executorType: "BASE" as const,
      payloadJson: { lockScreen: lockScreenRequested(values.payloadJson) }
    };
    const insertedRows = values.idempotencyKey
      ? await transaction.insert(mobileCommands).values(insertValues).onConflictDoNothing().returning()
      : await transaction.insert(mobileCommands).values(insertValues).returning();
    const command = insertedRows[0];
    if (!command && values.idempotencyKey) {
      const raced = await findByKey(transaction);
      if (raced) return reuseByKey(raced);
    }
    if (!command) {
      throw new Error("EXIT_AGENT_APP_COMMAND_CREATE_FAILED");
    }
    return { command, outcome: "created" as const };
  });
}

export async function ignorePendingCommandsByDeviceId(deviceId: string, commandTypes: string[], reason: string) {
  if (commandTypes.length === 0) {
    return [];
  }
  const now = new Date();
  return db
    .update(mobileCommands)
    .set({
      status: "IGNORED",
      resultJson: { reason },
      acknowledgedAt: now,
      updatedAt: now,
      updatedBy: "admin"
    })
    .where(
      and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(mobileCommands.deviceId, deviceId),
        inArray(mobileCommands.commandType, commandTypes),
        eq(mobileCommands.status, "PENDING"),
        isNull(mobileCommands.deletedAt),
        gt(mobileCommands.expiresAt, now)
      )
    )
    .returning();
}

export type MobileCommandListFilter = {
  batchId?: string;
  featureKey?: string;
};

export async function listMobileCommands(limit = 50, filter: MobileCommandListFilter = {}) {
  const conditions = [
    eq(mobileCommands.tenantId, config.tenantId),
    isNull(mobileCommands.deletedAt)
  ];
  if (filter.batchId) {
    conditions.push(sql`${mobileCommands.payloadJson} ->> 'batchId' = ${filter.batchId}`);
  }
  if (filter.featureKey) {
    conditions.push(sql`${mobileCommands.payloadJson} ->> 'featureKey' = ${filter.featureKey}`);
  }
  // A batch-scoped query must be able to restore every selected device;
  // the unfiltered admin list keeps its conservative recent-command window.
  const effectiveLimit = filter.batchId ? Math.max(limit, 1000) : limit;
  return db
    .select()
    .from(mobileCommands)
    .where(and(...conditions))
    .orderBy(desc(mobileCommands.createdAt))
    .limit(effectiveLimit);
}

export async function findPendingCommandsByDeviceId(deviceId: string, limit = 10) {
  const now = new Date();
  return db
    .select()
    .from(mobileCommands)
    .where(
      and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(mobileCommands.deviceId, deviceId),
        inArray(mobileCommands.status, ["PENDING", "FETCHED", "CLAIMED", "RUNNING"]),
        isNull(mobileCommands.deletedAt),
        gt(mobileCommands.expiresAt, now)
      )
    )
    .orderBy(mobileCommands.createdAt)
    .limit(limit);
}

type ClaimedCommand = {
  id: string;
  assignmentId: string | null;
  commandSequence: number | null;
  commandType: string;
  payloadJson: Record<string, unknown> | null;
  status: string;
  issuedAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
  claimToken: string;
};

export async function claimPendingCommandByDeviceId(deviceId: string, executorType: CommandExecutor) {
  const claimToken = randomUUID();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${config.tenantId}), hashtext(${`${deviceId}:${executorType}`}))`
    );
    await transaction.execute(sql`
      UPDATE mobile_commands
      SET status = 'TIMED_OUT',
          acknowledged_at = now(),
          result_json = jsonb_build_object('reason', 'base_command_ack_timeout'),
          updated_at = now(),
          updated_by = 'command_base_timeout'
      WHERE tenant_id = ${config.tenantId}
        AND device_id = ${deviceId}
        AND executor_type = 'BASE'
        AND status IN ('CLAIMED', 'RUNNING')
        AND claimed_at <= now() - interval '45 seconds'
        AND deleted_at IS NULL
    `);
    await transaction.execute(sql`
      UPDATE mobile_commands
      SET status = 'TIMED_OUT', acknowledged_at = now(), updated_at = now(), updated_by = 'command_timeout'
      WHERE tenant_id = ${config.tenantId}
        AND device_id = ${deviceId}
        AND executor_type = ${executorType}
        AND status IN ('CLAIMED', 'RUNNING')
        AND expires_at <= now()
        AND deleted_at IS NULL
    `);

    const rows = await transaction.execute<ClaimedCommand>(sql`
      WITH candidate AS (
        SELECT command.id
        FROM mobile_commands AS command
        WHERE command.tenant_id = ${config.tenantId}
          AND command.device_id = ${deviceId}
          AND command.executor_type = ${executorType}
          AND command.status = 'PENDING'
          AND command.deleted_at IS NULL
          AND command.expires_at > now()
          -- A stop is a control message: it must be claimable while its
          -- matching run is still active, but it must not open a second
          -- business worker on the same device.
          AND (
            NOT EXISTS (
              SELECT 1
              FROM mobile_commands AS active
              WHERE active.tenant_id = command.tenant_id
                AND active.device_id = command.device_id
                AND active.executor_type = command.executor_type
                AND active.status IN ('CLAIMED', 'RUNNING')
                AND active.command_type <> 'ACCOUNT_WARMUP_STOP'
                AND active.deleted_at IS NULL
            )
            OR command.command_type = 'ACCOUNT_WARMUP_STOP'
          )
          AND (
            command.command_type = 'ACCOUNT_WARMUP_STOP'
            OR NOT EXISTS (
              SELECT 1
              FROM mobile_commands AS active_stop
              WHERE active_stop.tenant_id = command.tenant_id
                AND active_stop.device_id = command.device_id
                AND active_stop.executor_type = command.executor_type
                AND active_stop.command_type = 'ACCOUNT_WARMUP_STOP'
                AND active_stop.status IN ('CLAIMED', 'RUNNING')
                AND active_stop.deleted_at IS NULL
            )
          )
          AND (
            command.command_type <> 'ACCOUNT_WARMUP_STOP'
            OR NOT EXISTS (
              SELECT 1
              FROM mobile_commands AS run
              WHERE run.tenant_id = command.tenant_id
                AND run.device_id = command.device_id
                AND run.executor_type = command.executor_type
                AND run.command_type = 'ACCOUNT_WARMUP_RUN'
                AND run.status IN ('CLAIMED', 'RUNNING')
                AND run.deleted_at IS NULL
            )
            OR EXISTS (
              SELECT 1
              FROM mobile_commands AS run
              WHERE run.tenant_id = command.tenant_id
                AND run.device_id = command.device_id
                AND run.executor_type = command.executor_type
                AND run.command_type = 'ACCOUNT_WARMUP_RUN'
                AND run.status IN ('CLAIMED', 'RUNNING')
                AND run.deleted_at IS NULL
                AND run.id::text = command.payload_json ->> 'targetCommandId'
                AND run.payload_json ->> 'batchId' = command.payload_json ->> 'batchId'
            )
          )
        ORDER BY command.created_at, command.id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE mobile_commands AS command
      SET status = 'CLAIMED',
          claimed_at = now(),
          claim_token = ${claimToken},
          fetched_at = now(),
          updated_at = now(),
          updated_by = ${executorType === "BASE" ? "native_base" : "mobile_agent"}
      FROM candidate
      WHERE command.id = candidate.id
      RETURNING
        command.id,
        command.assignment_id AS "assignmentId",
        command.command_sequence AS "commandSequence",
        command.command_type AS "commandType",
        command.payload_json AS "payloadJson",
        command.status,
        command.issued_at AS "issuedAt",
        command.expires_at AS "expiresAt",
        command.created_at AS "createdAt",
        command.claim_token AS "claimToken"
    `);
    return rows[0] ?? null;
  });
}

export async function updateMobileCommandStatus(
  commandId: string,
  status: "FETCHED" | "CLAIMED" | "RUNNING" | "DONE" | "FAILED" | "IGNORED" | "TIMED_OUT",
  values: Partial<typeof mobileCommands.$inferInsert> = {},
  expectedDeviceId?: string
) {
  const patch: Partial<typeof mobileCommands.$inferInsert> = {
    ...values,
    status,
    updatedAt: new Date()
  };
  if (status === "FETCHED" || status === "CLAIMED") {
    patch.fetchedAt = new Date();
  }
  if (status === "DONE" || status === "FAILED" || status === "IGNORED" || status === "TIMED_OUT") {
    patch.acknowledgedAt = new Date();
  }

  const terminalGuard = status === "DONE" || status === "FAILED" || status === "IGNORED" || status === "TIMED_OUT"
    ? inArray(mobileCommands.status, ["PENDING", "FETCHED", "CLAIMED", "RUNNING"])
    : undefined;
  const whereClause = expectedDeviceId
    ? and(eq(mobileCommands.tenantId, config.tenantId), eq(mobileCommands.id, commandId), eq(mobileCommands.deviceId, expectedDeviceId), terminalGuard, isNull(mobileCommands.deletedAt))
    : and(eq(mobileCommands.tenantId, config.tenantId), eq(mobileCommands.id, commandId), terminalGuard, isNull(mobileCommands.deletedAt));

  const [command] = await db.update(mobileCommands).set(patch).where(whereClause).returning();
  return command;
}

export async function updateClaimedBaseCommandStatus(
  commandId: string,
  deviceId: string,
  claimToken: string,
  status: "DONE" | "FAILED",
  result: Record<string, unknown>
) {
  const now = new Date();
  const [command] = await db
    .update(mobileCommands)
    .set({
      status,
      resultJson: result,
      acknowledgedAt: now,
      updatedAt: now,
      updatedBy: "android_base"
    })
    .where(and(
      eq(mobileCommands.tenantId, config.tenantId),
      eq(mobileCommands.id, commandId),
      eq(mobileCommands.deviceId, deviceId),
      eq(mobileCommands.executorType, "BASE"),
      eq(mobileCommands.claimToken, claimToken),
      inArray(mobileCommands.status, ["CLAIMED", "RUNNING"]),
      isNull(mobileCommands.deletedAt)
    ))
    .returning();
  return command ?? null;
}

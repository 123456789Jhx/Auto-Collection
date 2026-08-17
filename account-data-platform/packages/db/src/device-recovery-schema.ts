import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { collectorDevices, mobileCommands } from "./schema";

const auditColumns = {
  tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 64 }).notNull().default("system"),
  updatedBy: varchar("updated_by", { length: 64 }).notNull().default("system")
};

export const deviceRecoverySessions = pgTable(
  "device_recovery_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    commandId: uuid("command_id").references(() => mobileCommands.id),
    bootId: varchar("boot_id", { length: 128 }),
    source: varchar("source", { length: 32 }).$type<"AUTO_BOOT" | "MANUAL_WAKE">().notNull(),
    channel: varchar("channel", { length: 32 }).$type<"AGENT_POLL" | "XIAOMI_PUSH">(),
    stage: varchar("stage", { length: 32 }).notNull().default("WAITING_DEVICE"),
    resultStatus: varchar("result_status", { length: 32 }),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: varchar("error_message", { length: 500 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastStageAt: timestamp("last_stage_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_device_recovery_session_command")
      .on(table.tenantId, table.commandId)
      .where(sql`${table.commandId} is not null`),
    uniqueIndex("uniq_device_recovery_session_boot")
      .on(table.tenantId, table.deviceId, table.bootId)
      .where(sql`${table.bootId} is not null`),
    index("idx_device_recovery_session_device_started")
      .on(table.tenantId, table.deviceId, table.startedAt),
    index("idx_device_recovery_session_active_stage")
      .on(table.tenantId, table.resultStatus, table.stage, table.lastStageAt)
  ]
);

export const deviceRecoveryStageEvents = pgTable(
  "device_recovery_stage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => deviceRecoverySessions.id),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    eventKey: varchar("event_key", { length: 200 }).notNull(),
    stage: varchar("stage", { length: 32 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
    detailsJson: jsonb("details_json").$type<Record<string, unknown>>(),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_device_recovery_stage_event_key")
      .on(table.tenantId, table.deviceId, table.eventKey),
    index("idx_device_recovery_stage_event_session_occurred")
      .on(table.tenantId, table.sessionId, table.occurredAt)
  ]
);

import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { collectorDevices, mobileCommands } from "./schema";

export const remoteWakeAttempts = pgTable(
  "remote_wake_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
    commandId: uuid("command_id").notNull().references(() => mobileCommands.id),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    channel: varchar("channel", { length: 32 }).notNull(),
    stage: varchar("stage", { length: 32 }).notNull().default("CREATED"),
    resultStatus: varchar("result_status", { length: 32 }),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: varchar("error_message", { length: 500 }),
    ackTokenHash: varchar("ack_token_hash", { length: 64 }),
    pushMessageId: varchar("push_message_id", { length: 160 }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deviceReceivedAt: timestamp("device_received_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("uniq_remote_wake_attempt_command").on(table.tenantId, table.commandId),
    index("idx_remote_wake_attempt_device_created").on(table.tenantId, table.deviceId, table.createdAt),
    index("idx_remote_wake_attempt_stage_expiry").on(table.tenantId, table.stage, table.expiresAt)
  ]
);

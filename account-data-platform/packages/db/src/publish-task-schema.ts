import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import { collectorDevices } from "./schema";
import { publishRuns, publishSlotExecutions } from "./publish-interface-schema";
import { remoteScriptConfigs } from "./schema-remote-script";

const auditColumns = {
  tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 64 }).notNull().default("system"),
  updatedBy: varchar("updated_by", { length: 64 }).notNull().default("system"),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
};

export const publishTasks = pgTable(
  "publish_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    configId: uuid("config_id").notNull().references(() => remoteScriptConfigs.id),
    taskId: varchar("task_id", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull(),
    accountName: varchar("account_name", { length: 100 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description").notNull(),
    coverUrl: text("cover_url"),
    videoUrl: text("video_url").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("CLAIMED"),
    source: varchar("source", { length: 32 }).notNull().default("EXTERNAL_PULL"),
    mode: varchar("mode", { length: 32 }).notNull().default("IMMEDIATE"),
    reportMode: varchar("report_mode", { length: 32 }).notNull().default("EXTERNAL"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    batchId: varchar("batch_id", { length: 255 }),
    reportStatus: varchar("report_status", { length: 32 }).notNull().default("REPORT_PENDING"),
    reportAttempts: integer("report_attempts").notNull().default(0),
    reportLastError: text("report_last_error"),
    matchedDeviceId: uuid("matched_device_id").references(() => collectorDevices.id),
    matchNote: varchar("match_note", { length: 500 }),
    resultError: text("result_error"),
    failureCode: varchar("failure_code", { length: 64 }),
    dispatchRetryCount: integer("dispatch_retry_count").notNull().default(0),
    nextDispatchAt: timestamp("next_dispatch_at", { withTimezone: true }),
    lastDispatchAttemptAt: timestamp("last_dispatch_attempt_at", { withTimezone: true }),
    publishedUrl: text("published_url"),
    platformContentId: varchar("platform_content_id", { length: 255 }),
    scheduledSlot: timestamp("scheduled_slot", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    interfaceRunId: uuid("interface_run_id").references((): AnyPgColumn => publishRuns.id),
    slotExecutionId: uuid("slot_execution_id").references((): AnyPgColumn => publishSlotExecutions.id),
    localResultStatus: varchar("local_result_status", { length: 32 }),
    errorCategory: varchar("error_category", { length: 64 }),
    sideEffectStartedAt: timestamp("side_effect_started_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_publish_tasks_tenant_platform_task")
      .on(table.tenantId, table.platform, table.taskId),
    index("idx_publish_tasks_tenant_config_status")
      .on(table.tenantId, table.configId, table.status),
    index("idx_publish_tasks_tenant_source_status")
      .on(table.tenantId, table.source, table.status),
    index("idx_publish_tasks_tenant_batch_id")
      .on(table.tenantId, table.batchId),
    index("idx_publish_tasks_tenant_matched_device")
      .on(table.tenantId, table.matchedDeviceId),
    index("idx_publish_tasks_tenant_busy_retry")
      .on(table.tenantId, table.status, table.nextDispatchAt),
    index("idx_publish_tasks_tenant_interface_run")
      .on(table.tenantId, table.interfaceRunId),
    uniqueIndex("uniq_publish_tasks_tenant_slot_execution")
      .on(table.tenantId, table.slotExecutionId)
      .where(sql`${table.slotExecutionId} is not null`)
  ]
);

export const publishScheduleRuns = pgTable(
  "publish_schedule_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
    configId: uuid("config_id").notNull().references(() => remoteScriptConfigs.id),
    slotAt: timestamp("slot_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("RUNNING"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    claimedCount: integer("claimed_count").notNull().default(0),
    dispatchedCount: integer("dispatched_count").notNull().default(0),
    reportedCount: integer("reported_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("uniq_publish_schedule_runs_tenant_config_slot")
      .on(table.tenantId, table.configId, table.slotAt),
    index("idx_publish_schedule_runs_tenant_status_slot")
      .on(table.tenantId, table.status, table.slotAt)
  ]
);

export const publishStatusOutbox = pgTable(
  "publish_status_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
    publishTaskId: uuid("publish_task_id").notNull().references(() => publishTasks.id),
    status: varchar("status", { length: 32 }).notNull().default("REPORT_PENDING"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    targetStatus: varchar("target_status", { length: 32 }),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("uniq_publish_status_outbox_tenant_task")
      .on(table.tenantId, table.publishTaskId),
    index("idx_publish_status_outbox_tenant_status_created")
      .on(table.tenantId, table.status, table.createdAt),
    index("idx_publish_status_outbox_tenant_retry")
      .on(table.tenantId, table.status, table.nextRetryAt)
  ]
);

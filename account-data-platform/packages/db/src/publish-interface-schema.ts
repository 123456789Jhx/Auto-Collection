import { sql } from "drizzle-orm";
import {
  boolean,
  date,
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
import { publishTasks } from "./publish-task-schema";
import { publishAccountBindings } from "./publish-routing-schema";
import { remoteScriptConfigs } from "./schema-remote-script";
import { collectorDevices, deviceTaskAssignments } from "./schema";

const auditColumns = {
  tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 64 }).notNull().default("system"),
  updatedBy: varchar("updated_by", { length: 64 }).notNull().default("system"),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
};

export const publishRuns = pgTable(
  "publish_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    configId: uuid("config_id").notNull().references(() => remoteScriptConfigs.id),
    status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Shanghai"),
    morningWindowStart: varchar("morning_window_start", { length: 5 }).notNull().default("06:00"),
    morningWindowEnd: varchar("morning_window_end", { length: 5 }).notNull().default("12:00"),
    morningPublishTime: varchar("morning_publish_time", { length: 5 }).notNull(),
    afternoonWindowStart: varchar("afternoon_window_start", { length: 5 }).notNull().default("13:00"),
    afternoonWindowEnd: varchar("afternoon_window_end", { length: 5 }).notNull().default("24:00"),
    afternoonPublishTime: varchar("afternoon_publish_time", { length: 5 }).notNull(),
    maxConcurrentPublishing: integer("max_concurrent_publishing").notNull().default(3),
    noMaterialRetryMinutes: integer("no_material_retry_minutes").notNull().default(10),
    startedBy: varchar("started_by", { length: 64 }).notNull(),
    confirmedBy: varchar("confirmed_by", { length: 64 }),
    stopRequestedBy: varchar("stop_requested_by", { length: 64 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_publish_runs_one_active_per_tenant")
      .on(table.tenantId)
      .where(sql`${table.deletedAt} is null and ${table.status} not in ('STOPPED', 'FAILED', 'CANCELED')`),
    index("idx_publish_runs_tenant_status").on(table.tenantId, table.status),
    index("idx_publish_runs_tenant_config").on(table.tenantId, table.configId)
  ]
);

export const publishRunBindings = pgTable(
  "publish_run_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => publishRuns.id),
    bindingId: uuid("binding_id").notNull().references(() => publishAccountBindings.id),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    deviceCode: varchar("device_code", { length: 64 }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("DOUYIN"),
    accountName: varchar("account_name", { length: 100 }).notNull(),
    accountNo: varchar("account_no", { length: 100 }).notNull(),
    externalAccountKey: varchar("external_account_key", { length: 255 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    reservationStatus: varchar("reservation_status", { length: 32 }).notNull().default("WAITING_DEVICE"),
    assignmentId: uuid("assignment_id").references(() => deviceTaskAssignments.id),
    skippedForRun: boolean("skipped_for_run").notNull().default(false),
    skipReason: text("skip_reason"),
    reservationReason: text("reservation_reason"),
    nextReservationRetryAt: timestamp("next_reservation_retry_at", { withTimezone: true }),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_publish_run_bindings_run_binding")
      .on(table.tenantId, table.runId, table.bindingId),
    uniqueIndex("uniq_publish_run_bindings_run_device")
      .on(table.tenantId, table.runId, table.deviceCode),
    index("idx_publish_run_bindings_reservation")
      .on(table.tenantId, table.runId, table.reservationStatus, table.nextReservationRetryAt),
    index("idx_publish_run_bindings_assignment")
      .on(table.tenantId, table.assignmentId)
  ]
);

export const publishSlotExecutions = pgTable(
  "publish_slot_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => publishRuns.id),
    bindingId: uuid("binding_id").notNull().references(() => publishAccountBindings.id),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("DOUYIN"),
    slot: varchar("slot", { length: 16 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("WAITING"),
    externalTaskId: varchar("external_task_id", { length: 255 }),
    claimId: varchar("claim_id", { length: 255 }),
    publishTaskId: uuid("publish_task_id").references(() => publishTasks.id),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCategory: varchar("error_category", { length: 64 }),
    lastError: text("last_error"),
    sideEffectStartedAt: timestamp("side_effect_started_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_publish_slot_executions_daily_slot").on(
      table.tenantId,
      table.businessDate,
      table.platform,
      table.bindingId,
      table.slot
    ),
    uniqueIndex("uniq_publish_slot_executions_external_task")
      .on(table.tenantId, table.platform, table.externalTaskId)
      .where(sql`${table.externalTaskId} is not null`),
    index("idx_publish_slot_executions_run_status")
      .on(table.tenantId, table.runId, table.status, table.nextRetryAt),
    index("idx_publish_slot_executions_publish_task")
      .on(table.tenantId, table.publishTaskId)
  ]
);

export const publishInterfaceAlerts = pgTable(
  "publish_interface_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => publishRuns.id),
    slotExecutionId: uuid("slot_execution_id").references(() => publishSlotExecutions.id),
    code: varchar("code", { length: 100 }).notNull(),
    severity: varchar("severity", { length: 16 }).notNull(),
    message: text("message").notNull(),
    detailsJson: jsonb("details_json").$type<Record<string, unknown>>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    index("idx_publish_interface_alerts_run_unread")
      .on(table.tenantId, table.runId, table.readAt),
    index("idx_publish_interface_alerts_slot")
      .on(table.tenantId, table.slotExecutionId)
  ]
);

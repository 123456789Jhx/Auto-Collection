import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import { collectorDevices } from "./schema";
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
    matchedDeviceId: uuid("matched_device_id").references(() => collectorDevices.id),
    matchNote: varchar("match_note", { length: 500 }),
    resultError: text("result_error"),
    publishedUrl: text("published_url"),
    platformContentId: varchar("platform_content_id", { length: 255 }),
    scheduledSlot: timestamp("scheduled_slot", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_publish_tasks_tenant_platform_task")
      .on(table.tenantId, table.platform, table.taskId),
    index("idx_publish_tasks_tenant_config_status")
      .on(table.tenantId, table.configId, table.status),
    index("idx_publish_tasks_tenant_matched_device")
      .on(table.tenantId, table.matchedDeviceId)
  ]
);

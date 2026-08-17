import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { remoteScriptConfigs } from "./schema-remote-script";

const auditColumns = {
  tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 64 }).notNull().default("system"),
  updatedBy: varchar("updated_by", { length: 64 }).notNull().default("system"),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
};

export const publishAccountBindings = pgTable(
  "publish_account_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceCode: varchar("device_code", { length: 64 }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull(),
    accountName: varchar("account_name", { length: 100 }).notNull(),
    accountNo: varchar("account_no", { length: 100 }),
    externalAccountKey: varchar("external_account_key", { length: 255 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_publish_account_bindings_active_account")
      .on(table.tenantId, table.platform, table.accountName)
      .where(sql`${table.enabled} = true and ${table.deletedAt} is null`),
    uniqueIndex("uniq_publish_account_bindings_active_external_account_key")
      .on(table.tenantId, table.platform, table.externalAccountKey)
      .where(sql`${table.enabled} = true and ${table.deletedAt} is null`),
    uniqueIndex("uniq_publish_account_bindings_active_device_platform")
      .on(table.tenantId, table.deviceCode, table.platform)
      .where(sql`${table.enabled} = true and ${table.deletedAt} is null`),
    index("idx_publish_account_bindings_tenant_device_platform")
      .on(table.tenantId, table.deviceCode, table.platform)
  ]
);

export const publishClaimQuarantines = pgTable(
  "publish_claim_quarantines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceCode: varchar("device_code", { length: 64 }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull(),
    accountName: varchar("account_name", { length: 100 }).notNull(),
    reason: varchar("reason", { length: 64 }).notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }).notNull(),
    lastExternalTaskId: varchar("last_external_task_id", { length: 255 }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_publish_claim_quarantines_tenant_lane")
      .on(table.tenantId, table.deviceCode, table.platform, table.accountName)
      .where(sql`${table.deletedAt} is null`),
    index("idx_publish_claim_quarantines_tenant_blocked_until")
      .on(table.tenantId, table.blockedUntil)
  ]
);

export const publishDeviceSchedules = pgTable(
  "publish_device_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    configId: uuid("config_id").notNull().references(() => remoteScriptConfigs.id),
    deviceCode: varchar("device_code", { length: 64 }).notNull(),
    platforms: jsonb("platforms").$type<string[]>().notNull(),
    timeWindows: jsonb("time_windows").$type<Array<{ start: string; end: string }>>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_publish_device_schedules_tenant_config_device")
      .on(table.tenantId, table.configId, table.deviceCode)
      .where(sql`${table.deletedAt} is null`),
    index("idx_publish_device_schedules_tenant_enabled")
      .on(table.tenantId, table.enabled, table.deviceCode)
  ]
);

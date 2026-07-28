import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import { collectorDevices } from "./schema";

const auditColumns = {
  tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 64 }).notNull().default("system"),
  updatedBy: varchar("updated_by", { length: 64 }).notNull().default("system"),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
};

export const remoteScriptDefinitions = pgTable(
  "remote_script_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scriptKey: varchar("script_key", { length: 64 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    description: varchar("description", { length: 500 }),
    configSchema: jsonb("config_schema").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 32 }).notNull().default("ENABLED"),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_remote_script_definitions_tenant_script_key")
      .on(table.tenantId, table.scriptKey)
      .where(sql`${table.deletedAt} is null`)
  ]
);

export const remoteScriptConfigs = pgTable(
  "remote_script_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scriptKey: varchar("script_key", { length: 64 }).notNull(),
    configName: varchar("config_name", { length: 100 }).notNull(),
    configPayload: jsonb("config_payload").$type<Record<string, unknown>>().notNull(),
    revision: integer("revision").notNull().default(1),
    configHash: varchar("config_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("ENABLED"),
    remark: varchar("remark", { length: 500 }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_remote_script_configs_tenant_script_key_name")
      .on(table.tenantId, table.scriptKey, table.configName)
      .where(sql`${table.deletedAt} is null`),
    index("idx_remote_script_configs_tenant_script_key_status").on(table.tenantId, table.scriptKey, table.status),
    index("idx_remote_script_configs_tenant_created_at").on(table.tenantId, table.createdAt)
  ]
);

export const remoteScriptDeviceBindings = pgTable(
  "remote_script_device_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    configId: uuid("config_id").notNull().references(() => remoteScriptConfigs.id),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    priority: integer("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    ...auditColumns
  },
  (table) => [
    index("idx_remote_script_device_bindings_tenant_config").on(table.tenantId, table.configId),
    index("idx_remote_script_device_bindings_tenant_device").on(table.tenantId, table.deviceId),
    uniqueIndex("uniq_remote_script_device_bindings_tenant_config_device")
      .on(table.tenantId, table.configId, table.deviceId)
      .where(sql`${table.deletedAt} is null`)
  ]
);

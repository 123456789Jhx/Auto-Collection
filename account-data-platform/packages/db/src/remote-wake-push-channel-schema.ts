import { sql } from "drizzle-orm";
import { boolean, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { collectorDevices } from "./schema";

export const remoteWakePushChannels = pgTable(
  "device_remote_wake_push_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    provider: varchar("provider", { length: 32 }).notNull().default("XIAOMI_PUSH"),
    registrationId: varchar("registration_id", { length: 512 }).notNull(),
    appVersion: varchar("app_version", { length: 64 }),
    enabled: boolean("enabled").notNull().default(true),
    lastRegisteredAt: timestamp("last_registered_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("uniq_remote_wake_push_channel_device_provider")
      .on(table.tenantId, table.deviceId, table.provider)
      .where(sql`${table.deletedAt} is null`),
    index("idx_remote_wake_push_channel_registration")
      .on(table.tenantId, table.provider, table.registrationId)
  ]
);

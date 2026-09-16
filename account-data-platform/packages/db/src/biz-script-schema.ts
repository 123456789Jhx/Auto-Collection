import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { agentVersions } from "./schema";

export const bizScriptPreviews = pgTable("biz_script_previews", {
  id: uuid("id").primaryKey().references(() => agentVersions.id),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  stage: varchar("stage", { length: 16 }).notNull().default("DRAFT"),
  revision: integer("revision").notNull().default(0),
  previewJson: jsonb("preview_json").$type<Record<string, unknown>>().notNull(),
  testDeviceIds: jsonb("test_device_ids").$type<string[]>().notNull().default([]),
  deviceIds: jsonb("device_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 64 }).notNull(),
  updatedBy: varchar("updated_by", { length: 64 }).notNull()
}, (table) => [index("idx_biz_script_previews_tenant_created_at").on(table.tenantId, table.createdAt)]);

export const bizScriptArchives = pgTable("biz_script_archives", {
  id: uuid("id").primaryKey().references(() => bizScriptPreviews.id),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  archiveBase64: text("archive_base64").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const bizScriptAudits = pgTable("biz_script_audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  previewId: uuid("preview_id").notNull().references(() => bizScriptPreviews.id),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  stage: varchar("stage", { length: 16 }).notNull(),
  revision: integer("revision").notNull(),
  testDeviceIds: jsonb("test_device_ids").$type<string[]>().notNull(),
  deviceIds: jsonb("device_ids").$type<string[]>().notNull(),
  actor: varchar("actor", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("uniq_biz_script_audits_revision").on(table.tenantId, table.previewId, table.revision)]);

import { relations, sql } from "drizzle-orm";
import {
  boolean,
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

const auditColumns = {
  tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 64 }).notNull().default("system"),
  updatedBy: varchar("updated_by", { length: 64 }).notNull().default("system"),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
};

export const collectorDevices = pgTable(
  "collector_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceCode: varchar("device_code", { length: 64 }).notNull(),
    deviceName: varchar("device_name", { length: 100 }),
    deviceToken: varchar("device_token", { length: 128 }),
    enabled: boolean("enabled").notNull().default(true),
    lastIp: varchar("last_ip", { length: 64 }),
    lastRegion: varchar("last_region", { length: 100 }),
    remark: varchar("remark", { length: 500 }),
    accountProfile: jsonb("account_profile").$type<Record<string, unknown>>(),
    platform: varchar("platform", { length: 32 }),
    appVersion: varchar("app_version", { length: 64 }),
    targetVersion: varchar("target_version", { length: 64 }),
    updateStatus: varchar("update_status", { length: 32 }),
    lastCommandAt: timestamp("last_command_at", { withTimezone: true }),
    lastErrorMessage: varchar("last_error_message", { length: 500 }),
    status: varchar("status", { length: 32 }).notNull().default("online"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_collector_devices_tenant_device_code").on(table.tenantId, table.deviceCode),
    uniqueIndex("uniq_collector_devices_tenant_device_token").on(table.tenantId, table.deviceToken).where(sql`${table.deviceToken} is not null and ${table.deletedAt} is null`),
    index("idx_collector_devices_tenant_status").on(table.tenantId, table.status)
  ]
);

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: varchar("version", { length: 64 }).notNull(),
    channel: varchar("channel", { length: 32 }).notNull().default("stable"),
    minSupportedVersion: varchar("min_supported_version", { length: 64 }),
    packageUrl: text("package_url"),
    sha256: varchar("sha256", { length: 128 }),
    entryFile: varchar("entry_file", { length: 100 }).notNull().default("main.js"),
    releaseNote: text("release_note"),
    forceUpdate: boolean("force_update").notNull().default(false),
    status: varchar("status", { length: 32 }).notNull().default("PUBLISHED"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_agent_versions_tenant_channel_version").on(table.tenantId, table.channel, table.version),
    index("idx_agent_versions_tenant_channel_status").on(table.tenantId, table.channel, table.status)
  ]
);

export const collectionTasks = pgTable(
  "collection_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskCode: varchar("task_code", { length: 64 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("douyin"),
    mode: varchar("mode", { length: 32 }).notNull().default("search"),
    searchKeywords: jsonb("search_keywords").$type<string[]>().notNull(),
    matchKeywords: jsonb("match_keywords").$type<string[]>().notNull(),
    videoMinutesMin: integer("video_minutes_min").notNull().default(120),
    videoMinutesMax: integer("video_minutes_max").notNull().default(180),
    liveMinutesMin: integer("live_minutes_min").notNull().default(60),
    liveMinutesMax: integer("live_minutes_max").notNull().default(120),
    autoStart: boolean("auto_start").notNull().default(false),
    collectComments: boolean("collect_comments").notNull().default(true),
    commentLimit: integer("comment_limit").notNull().default(10),
    liveCommentConfig: jsonb("live_comment_config").$type<Record<string, unknown>>(),
    liveCommentBotConfig: jsonb("live_comment_bot_config").$type<Record<string, unknown>>(),
    p3ExtensionsConfig: jsonb("p3_extensions_config").$type<Record<string, unknown>>(),
    heartbeatMinutes: integer("heartbeat_minutes").notNull().default(1),
    status: varchar("status", { length: 32 }).notNull().default("ENABLED"),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_collection_tasks_tenant_task_code").on(table.tenantId, table.taskCode),
    index("idx_collection_tasks_tenant_status").on(table.tenantId, table.status)
  ]
);

export const deviceTaskConfigs = pgTable(
  "device_task_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    taskId: uuid("task_id").notNull().references(() => collectionTasks.id),
    videoMinutesMin: integer("video_minutes_min").notNull().default(120),
    videoMinutesMax: integer("video_minutes_max").notNull().default(180),
    liveMinutesMin: integer("live_minutes_min").notNull().default(60),
    liveMinutesMax: integer("live_minutes_max").notNull().default(120),
    autoStart: boolean("auto_start").notNull().default(false),
    collectComments: boolean("collect_comments").notNull().default(true),
    commentLimit: integer("comment_limit").notNull().default(10),
    liveCommentRole: varchar("live_comment_role", { length: 32 }).notNull().default("none"),
    liveCommentGroup: varchar("live_comment_group", { length: 16 }),
    followedAccountName: varchar("followed_account_name", { length: 100 }),
    followedAccountId: varchar("followed_account_id", { length: 100 }),
    followedAliases: jsonb("followed_aliases").$type<string[]>(),
    liveCommentMode: varchar("live_comment_mode", { length: 32 }).notNull().default("agri_chatbot"),
    liveCommentBotConfig: jsonb("live_comment_bot_config").$type<Record<string, unknown>>(),
    liveCommentConfig: jsonb("live_comment_config").$type<Record<string, unknown>>(),
    p3ExtensionsConfig: jsonb("p3_extensions_config").$type<Record<string, unknown>>(),
    heartbeatMinutes: integer("heartbeat_minutes").notNull().default(1),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_device_task_configs_tenant_device_task").on(table.tenantId, table.deviceId, table.taskId),
    index("idx_device_task_configs_tenant_device").on(table.tenantId, table.deviceId),
    index("idx_device_task_configs_tenant_task_live_comment_role").on(table.tenantId, table.taskId, table.liveCommentRole)
  ]
);

export const collectionRecords = pgTable(
  "collection_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => collectionTasks.id),
    deviceId: uuid("device_id").references(() => collectorDevices.id),
    platform: varchar("platform", { length: 32 }).notNull(),
    sceneType: varchar("scene_type", { length: 32 }).notNull(),
    keyword: varchar("keyword", { length: 100 }),
    matchedKeywords: jsonb("matched_keywords").$type<string[]>(),
    authorName: varchar("author_name", { length: 200 }),
    titleText: text("title_text"),
    subtitleText: text("subtitle_text"),
    metricsText: text("metrics_text"),
    hotCommentsJson: jsonb("hot_comments_json").$type<string[]>(),
    screenText: text("screen_text"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    index("idx_collection_records_tenant_created_at").on(table.tenantId, table.createdAt),
    index("idx_collection_records_tenant_device_id").on(table.tenantId, table.deviceId)
  ]
);

export const deviceHeartbeats = pgTable(
  "device_heartbeats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => collectionTasks.id),
    deviceId: uuid("device_id").references(() => collectorDevices.id),
    status: varchar("status", { length: 32 }).notNull(),
    sceneType: varchar("scene_type", { length: 32 }),
    elapsedMinutes: integer("elapsed_minutes"),
    remainingMinutes: integer("remaining_minutes"),
    viewedCount: integer("viewed_count"),
    liveViewedCount: integer("live_viewed_count"),
    liveRoomEnteredCount: integer("live_room_entered_count"),
    liveCandidateCount: integer("live_candidate_count"),
    liveRejectedCount: integer("live_rejected_count"),
    capturedCount: integer("captured_count"),
    lastMessage: varchar("last_message", { length: 500 }),
    expectedEndAt: timestamp("expected_end_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [index("idx_device_heartbeats_tenant_device_created_at").on(table.tenantId, table.deviceId, table.createdAt)]
);

export const runtimeLogs = pgTable(
  "runtime_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => collectionTasks.id),
    deviceId: uuid("device_id").references(() => collectorDevices.id),
    level: varchar("level", { length: 16 }).notNull(),
    message: varchar("message", { length: 500 }).notNull(),
    contextJson: jsonb("context_json").$type<Record<string, unknown>>(),
    stopReason: varchar("stop_reason", { length: 64 }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    index("idx_runtime_logs_tenant_device_created_at").on(table.tenantId, table.deviceId, table.createdAt),
    index("idx_runtime_logs_tenant_level").on(table.tenantId, table.level)
  ]
);

export const deviceLogFiles = pgTable(
  "device_log_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id").references(() => collectorDevices.id),
    taskId: uuid("task_id").references(() => collectionTasks.id),
    logDate: varchar("log_date", { length: 10 }).notNull(),
    fileName: varchar("file_name", { length: 200 }).notNull(),
    content: text("content").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull().default(0),
    infoCount: integer("info_count").notNull().default(0),
    warnCount: integer("warn_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    lastErrorReason: varchar("last_error_reason", { length: 500 }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_device_log_files_tenant_device_date_name").on(table.tenantId, table.deviceId, table.logDate, table.fileName).where(sql`${table.deletedAt} is null`),
    index("idx_device_log_files_tenant_device_date").on(table.tenantId, table.deviceId, table.logDate),
    index("idx_device_log_files_tenant_created_at").on(table.tenantId, table.createdAt)
  ]
);

export const mobileCommands = pgTable(
  "mobile_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => collectionTasks.id),
    deviceId: uuid("device_id").references(() => collectorDevices.id),
    commandType: varchar("command_type", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("PENDING"),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    index("idx_mobile_commands_tenant_device_status").on(table.tenantId, table.deviceId, table.status),
    index("idx_mobile_commands_tenant_created_at").on(table.tenantId, table.createdAt)
  ]
);

export const deviceTaskAssignments = pgTable(
  "device_task_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    taskId: uuid("task_id").references(() => collectionTasks.id),
    commandId: uuid("command_id").references(() => mobileCommands.id),
    taskType: varchar("task_type", { length: 32 }).notNull(),
    targetContext: varchar("target_context", { length: 64 }),
    status: varchar("status", { length: 32 }).notNull().default("PENDING"),
    priority: integer("priority").notNull().default(100),
    source: varchar("source", { length: 64 }).notNull().default("manual"),
    reason: varchar("reason", { length: 200 }),
    desiredPayload: jsonb("desired_payload").$type<Record<string, unknown>>(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    index("idx_device_task_assignments_tenant_device_created_at").on(table.tenantId, table.deviceId, table.createdAt),
    index("idx_device_task_assignments_tenant_status").on(table.tenantId, table.status),
    index("idx_device_task_assignments_tenant_command").on(table.tenantId, table.commandId)
  ]
);

export const liveCommentActions = pgTable(
  "live_comment_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => collectionTasks.id),
    deviceId: uuid("device_id").references(() => collectorDevices.id),
    triggerEventId: varchar("trigger_event_id", { length: 128 }),
    platform: varchar("platform", { length: 32 }).notNull().default("douyin"),
    roomName: varchar("room_name", { length: 200 }),
    leaderAccountName: varchar("leader_account_name", { length: 200 }),
    triggerText: text("trigger_text"),
    matchedKeywords: jsonb("matched_keywords").$type<string[]>(),
    replyText: text("reply_text").notNull(),
    plannedDelayMs: integer("planned_delay_ms"),
    status: varchar("status", { length: 32 }).notNull(),
    skipReason: varchar("skip_reason", { length: 200 }),
    failureReason: varchar("failure_reason", { length: 500 }),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    plannedAt: timestamp("planned_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    index("idx_live_comment_actions_tenant_device_created_at").on(table.tenantId, table.deviceId, table.createdAt),
    index("idx_live_comment_actions_tenant_status").on(table.tenantId, table.status),
    index("idx_live_comment_actions_tenant_task").on(table.tenantId, table.taskId)
  ]
);

export const agentUpdateEvents = pgTable(
  "agent_update_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id").references(() => collectorDevices.id),
    agentVersionId: uuid("agent_version_id").references(() => agentVersions.id),
    fromVersion: varchar("from_version", { length: 64 }),
    toVersion: varchar("to_version", { length: 64 }),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    message: varchar("message", { length: 500 }),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    ...auditColumns
  },
  (table) => [
    index("idx_agent_update_events_tenant_device_created_at").on(table.tenantId, table.deviceId, table.createdAt),
    index("idx_agent_update_events_tenant_version_created_at").on(table.tenantId, table.agentVersionId, table.createdAt)
  ]
);

export const collectorDevicesRelations = relations(collectorDevices, ({ many }) => ({
  records: many(collectionRecords),
  heartbeats: many(deviceHeartbeats),
  logs: many(runtimeLogs),
  logFiles: many(deviceLogFiles),
  commands: many(mobileCommands),
  taskAssignments: many(deviceTaskAssignments),
  liveCommentActions: many(liveCommentActions),
  updateEvents: many(agentUpdateEvents),
  taskConfigs: many(deviceTaskConfigs)
}));

export const collectionTasksRelations = relations(collectionTasks, ({ many }) => ({
  records: many(collectionRecords),
  heartbeats: many(deviceHeartbeats),
  logs: many(runtimeLogs),
  logFiles: many(deviceLogFiles),
  commands: many(mobileCommands),
  taskAssignments: many(deviceTaskAssignments),
  liveCommentActions: many(liveCommentActions),
  deviceConfigs: many(deviceTaskConfigs)
}));

export const agentVersionsRelations = relations(agentVersions, ({ many }) => ({
  updateEvents: many(agentUpdateEvents)
}));

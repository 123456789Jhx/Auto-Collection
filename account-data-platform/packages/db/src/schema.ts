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
    capabilitiesJson: jsonb("capabilities_json").$type<Record<string, unknown>>(),
    capabilitiesReportedAt: timestamp("capabilities_reported_at", { withTimezone: true }),
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
    assignmentId: uuid("assignment_id"),
    commandSequence: integer("command_sequence"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }),
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
    index("idx_mobile_commands_tenant_created_at").on(table.tenantId, table.createdAt),
    index("idx_mobile_commands_tenant_assignment").on(table.tenantId, table.assignmentId),
    uniqueIndex("uniq_mobile_commands_tenant_assignment_sequence").on(table.tenantId, table.assignmentId, table.commandSequence).where(sql`${table.assignmentId} is not null and ${table.commandSequence} is not null and ${table.deletedAt} is null`),
    uniqueIndex("uniq_mobile_commands_tenant_idempotency_key").on(table.tenantId, table.idempotencyKey).where(sql`${table.idempotencyKey} is not null and ${table.deletedAt} is null`)
  ]
);

export const deviceTaskAssignments = pgTable(
  "device_task_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    taskId: uuid("task_id").references(() => collectionTasks.id),
    commandId: uuid("command_id").references(() => mobileCommands.id),
    startCommandId: uuid("start_command_id").references(() => mobileCommands.id),
    taskType: varchar("task_type", { length: 32 }).notNull(),
    selectedTargetId: uuid("selected_target_id").references(() => liveTargets.id),
    targetCode: varchar("target_code", { length: 64 }),
    configRevision: integer("config_revision"),
    configHash: varchar("config_hash", { length: 64 }),
    configSnapshot: jsonb("config_snapshot").$type<Record<string, unknown>>(),
    snapshotHash: varchar("snapshot_hash", { length: 64 }),
    executionApprovalId: uuid("execution_approval_id"),
    expectedAccountId: varchar("expected_account_id", { length: 100 }),
    expectedAccountName: varchar("expected_account_name", { length: 100 }),
    currentStage: varchar("current_stage", { length: 64 }),
    progressJson: jsonb("progress_json").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastEventSeq: integer("last_event_seq").notNull().default(0),
    stateVersion: integer("state_version").notNull().default(1),
    blockReason: varchar("block_reason", { length: 200 }),
    terminalReason: varchar("terminal_reason", { length: 200 }),
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
    index("idx_device_task_assignments_tenant_command").on(table.tenantId, table.commandId),
    index("idx_device_task_assignments_tenant_target").on(table.tenantId, table.selectedTargetId),
    index("idx_device_task_assignments_tenant_snapshot").on(table.tenantId, table.snapshotHash),
    uniqueIndex("uniq_device_task_assignments_one_active_per_device").on(table.tenantId, table.deviceId).where(sql`${table.deletedAt} is null and ${table.status} not in ('STOPPED','SUPERSEDED','CANCELLED','FAILED','COMPLETED','EXPIRED')`)
  ]
);

export const deviceTaskAssignmentEvents = pgTable(
  "device_task_assignment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id").notNull().references(() => deviceTaskAssignments.id),
    sequence: integer("sequence").notNull(),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    targetId: uuid("target_id").references(() => liveTargets.id),
    featureType: varchar("feature_type", { length: 64 }).notNull(),
    stage: varchar("stage", { length: 64 }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    fromState: varchar("from_state", { length: 32 }),
    toState: varchar("to_state", { length: 32 }),
    status: varchar("status", { length: 32 }).notNull(),
    reasonCode: varchar("reason_code", { length: 100 }),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    evidenceJson: jsonb("evidence_json").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actor: varchar("actor", { length: 32 }).notNull().default("system"),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_device_task_assignment_events_tenant_assignment_seq").on(table.tenantId, table.assignmentId, table.sequence),
    uniqueIndex("uniq_device_task_assignment_events_tenant_idempotency").on(table.tenantId, table.idempotencyKey).where(sql`${table.deletedAt} is null`),
    index("idx_device_task_assignment_events_tenant_device_occurred").on(table.tenantId, table.deviceId, table.occurredAt),
    index("idx_device_task_assignment_events_tenant_assignment").on(table.tenantId, table.assignmentId)
  ]
);

export const liveTargets = pgTable(
  "live_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetCode: varchar("target_code", { length: 64 }).notNull(),
    targetName: varchar("target_name", { length: 200 }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("douyin"),
    similarityThreshold: integer("similarity_threshold").notNull().default(90),
    enabled: boolean("enabled").notNull().default(true),
    remark: varchar("remark", { length: 500 }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_live_targets_tenant_target_code").on(table.tenantId, table.targetCode).where(sql`${table.deletedAt} is null`),
    index("idx_live_targets_tenant_platform_enabled").on(table.tenantId, table.platform, table.enabled)
  ]
);

export const liveTargetAliases = pgTable(
  "live_target_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id").notNull().references(() => liveTargets.id),
    aliasText: varchar("alias_text", { length: 200 }).notNull(),
    aliasType: varchar("alias_type", { length: 32 }).notNull().default("room_name"),
    weight: integer("weight").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    ...auditColumns
  },
  (table) => [
    index("idx_live_target_aliases_tenant_target").on(table.tenantId, table.targetId),
    uniqueIndex("uniq_live_target_aliases_tenant_target_text").on(table.tenantId, table.targetId, table.aliasText).where(sql`${table.deletedAt} is null`)
  ]
);

export const liveTargetFeatureConfigs = pgTable(
  "live_target_feature_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id").notNull().references(() => liveTargets.id),
    featureType: varchar("feature_type", { length: 64 }).notNull(),
    searchKeywords: jsonb("search_keywords").$type<string[]>().notNull().default([]),
    requiredKeywords: jsonb("required_keywords").$type<string[]>().notNull().default([]),
    forbiddenKeywords: jsonb("forbidden_keywords").$type<string[]>().notNull().default([]),
    productKeywords: jsonb("product_keywords").$type<string[]>().notNull().default([]),
    liveSignals: jsonb("live_signals").$type<string[]>().notNull().default([]),
    runtimeConfigJson: jsonb("runtime_config_json").$type<Record<string, unknown>>().notNull().default({}),
    revision: integer("revision").notNull().default(1),
    configHash: varchar("config_hash", { length: 64 }),
    enabled: boolean("enabled").notNull().default(true),
    ...auditColumns
  },
  (table) => [
    index("idx_live_target_feature_configs_tenant_target").on(table.tenantId, table.targetId),
    uniqueIndex("uniq_live_target_feature_configs_tenant_target_feature").on(table.tenantId, table.targetId, table.featureType).where(sql`${table.deletedAt} is null`)
  ]
);

export const liveTargetDeviceBindings = pgTable(
  "live_target_device_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id").references(() => collectorDevices.id),
    targetId: uuid("target_id").notNull().references(() => liveTargets.id),
    featureType: varchar("feature_type", { length: 64 }).notNull(),
    priority: integer("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    ...auditColumns
  },
  (table) => [
    index("idx_live_target_device_bindings_tenant_device").on(table.tenantId, table.deviceId),
    index("idx_live_target_device_bindings_tenant_target").on(table.tenantId, table.targetId),
    uniqueIndex("uniq_live_target_device_bindings_tenant_device_target_feature")
      .on(table.tenantId, table.deviceId, table.targetId, table.featureType)
      .where(sql`${table.deletedAt} is null`)
  ]
);

export const featureRolloutControls = pgTable(
  "feature_rollout_controls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    featureKey: varchar("feature_key", { length: 100 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    revision: integer("revision").notNull().default(1),
    minAppVersion: varchar("min_app_version", { length: 64 }),
    requiredCapabilitiesJson: jsonb("required_capabilities_json").$type<string[]>().notNull().default([]),
    capabilityTtlSeconds: integer("capability_ttl_seconds").notNull().default(600),
    reason: varchar("reason", { length: 500 }),
    ...auditColumns
  },
  (table) => [
    uniqueIndex("uniq_feature_rollout_controls_tenant_feature")
      .on(table.tenantId, table.featureKey)
      .where(sql`${table.deletedAt} is null`)
  ]
);

export const featureRolloutControlEvents = pgTable(
  "feature_rollout_control_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    controlId: uuid("control_id").notNull().references(() => featureRolloutControls.id),
    featureKey: varchar("feature_key", { length: 100 }).notNull(),
    fromRevision: integer("from_revision").notNull(),
    toRevision: integer("to_revision").notNull(),
    beforeJson: jsonb("before_json").$type<Record<string, unknown>>().notNull(),
    afterJson: jsonb("after_json").$type<Record<string, unknown>>().notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    actor: varchar("actor", { length: 64 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...auditColumns
  },
  (table) => [
    index("idx_feature_rollout_control_events_tenant_feature_occurred")
      .on(table.tenantId, table.featureKey, table.occurredAt),
    uniqueIndex("uniq_feature_rollout_control_events_tenant_control_revision")
      .on(table.tenantId, table.controlId, table.toRevision)
  ]
);

export const featureRolloutDeviceAllowlist = pgTable(
  "feature_rollout_device_allowlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    featureKey: varchar("feature_key", { length: 100 }).notNull(),
    deviceId: uuid("device_id").notNull().references(() => collectorDevices.id),
    enabled: boolean("enabled").notNull().default(true),
    ...auditColumns
  },
  (table) => [
    index("idx_feature_rollout_device_allowlist_tenant_feature").on(table.tenantId, table.featureKey),
    index("idx_feature_rollout_device_allowlist_tenant_device").on(table.tenantId, table.deviceId),
    uniqueIndex("uniq_feature_rollout_device_allowlist_tenant_feature_device")
      .on(table.tenantId, table.featureKey, table.deviceId)
      .where(sql`${table.deletedAt} is null`)
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
  taskConfigs: many(deviceTaskConfigs),
  liveTargetBindings: many(liveTargetDeviceBindings),
  featureRolloutAllowlist: many(featureRolloutDeviceAllowlist)
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

export const liveTargetsRelations = relations(liveTargets, ({ many }) => ({
  aliases: many(liveTargetAliases),
  featureConfigs: many(liveTargetFeatureConfigs),
  deviceBindings: many(liveTargetDeviceBindings)
}));

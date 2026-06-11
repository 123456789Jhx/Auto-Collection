ALTER TABLE "collector_devices" ADD COLUMN "target_version" varchar(64);
--> statement-breakpoint
ALTER TABLE "collector_devices" ADD COLUMN "update_status" varchar(32);
--> statement-breakpoint
ALTER TABLE "collector_devices" ADD COLUMN "last_command_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "collector_devices" ADD COLUMN "last_error_message" varchar(500);
--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(64) NOT NULL,
	"channel" varchar(32) DEFAULT 'stable' NOT NULL,
	"min_supported_version" varchar(64),
	"package_url" text,
	"sha256" varchar(128),
	"entry_file" varchar(100) DEFAULT 'main.js' NOT NULL,
	"release_note" text,
	"force_update" boolean DEFAULT false NOT NULL,
	"status" varchar(32) DEFAULT 'PUBLISHED' NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_update_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid,
	"agent_version_id" uuid,
	"from_version" varchar(64),
	"to_version" varchar(64),
	"event_type" varchar(32) NOT NULL,
	"message" varchar(500),
	"payload_json" jsonb,
	"reported_at" timestamp with time zone,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_update_events" ADD CONSTRAINT "agent_update_events_device_id_collector_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."collector_devices"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_update_events" ADD CONSTRAINT "agent_update_events_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_agent_versions_tenant_channel_version" ON "agent_versions" USING btree ("tenant_id","channel","version");
--> statement-breakpoint
CREATE INDEX "idx_agent_versions_tenant_channel_status" ON "agent_versions" USING btree ("tenant_id","channel","status");
--> statement-breakpoint
CREATE INDEX "idx_agent_update_events_tenant_device_created_at" ON "agent_update_events" USING btree ("tenant_id","device_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_agent_update_events_tenant_version_created_at" ON "agent_update_events" USING btree ("tenant_id","agent_version_id","created_at");
--> statement-breakpoint
COMMENT ON COLUMN "collector_devices"."target_version" IS '后台期望设备升级到的手机 Agent 版本号';
COMMENT ON COLUMN "collector_devices"."update_status" IS '设备版本更新状态：idle/checking/downloading/applying/done/failed/rollback';
COMMENT ON COLUMN "collector_devices"."last_command_at" IS '后台最后一次向该设备下发控制指令的时间';
COMMENT ON COLUMN "collector_devices"."last_error_message" IS '设备最近一次上报或后台记录的错误摘要';

COMMENT ON TABLE "agent_versions" IS '手机 Agent 版本发布表，记录可下发给远程手机脚本的版本信息';
COMMENT ON COLUMN "agent_versions"."id" IS '版本发布主键 UUID';
COMMENT ON COLUMN "agent_versions"."version" IS 'Agent 版本号，例如 0.2.0';
COMMENT ON COLUMN "agent_versions"."channel" IS '发布通道：stable/gray/dev';
COMMENT ON COLUMN "agent_versions"."min_supported_version" IS '最低支持版本，低于该版本的手机必须更新';
COMMENT ON COLUMN "agent_versions"."package_url" IS '版本包下载地址，后续公网部署后使用 HTTPS 地址';
COMMENT ON COLUMN "agent_versions"."sha256" IS '版本包 SHA-256 校验值';
COMMENT ON COLUMN "agent_versions"."entry_file" IS 'AutoX.js 入口文件，默认 main.js';
COMMENT ON COLUMN "agent_versions"."release_note" IS '版本更新说明';
COMMENT ON COLUMN "agent_versions"."force_update" IS '是否强制更新';
COMMENT ON COLUMN "agent_versions"."status" IS '版本状态：DRAFT/PUBLISHED/REVOKED';
COMMENT ON COLUMN "agent_versions"."published_at" IS '版本发布时间';
COMMENT ON COLUMN "agent_versions"."tenant_id" IS '租户编号，当前默认 default';
COMMENT ON COLUMN "agent_versions"."created_at" IS '创建时间';
COMMENT ON COLUMN "agent_versions"."updated_at" IS '更新时间';
COMMENT ON COLUMN "agent_versions"."created_by" IS '创建人或创建来源';
COMMENT ON COLUMN "agent_versions"."updated_by" IS '更新人或更新来源';
COMMENT ON COLUMN "agent_versions"."deleted_at" IS '软删除时间';

COMMENT ON TABLE "agent_update_events" IS '手机 Agent 更新事件表，记录检查、下载、校验、替换、失败和回滚过程';
COMMENT ON COLUMN "agent_update_events"."id" IS '更新事件主键 UUID';
COMMENT ON COLUMN "agent_update_events"."device_id" IS '关联采集设备主键';
COMMENT ON COLUMN "agent_update_events"."agent_version_id" IS '关联目标 Agent 版本主键';
COMMENT ON COLUMN "agent_update_events"."from_version" IS '更新前版本号';
COMMENT ON COLUMN "agent_update_events"."to_version" IS '目标版本号';
COMMENT ON COLUMN "agent_update_events"."event_type" IS '事件类型：CHECKED/DOWNLOADED/VERIFIED/APPLIED/FAILED/ROLLBACK';
COMMENT ON COLUMN "agent_update_events"."message" IS '事件说明或失败摘要';
COMMENT ON COLUMN "agent_update_events"."payload_json" IS '更新事件扩展上下文 JSON';
COMMENT ON COLUMN "agent_update_events"."reported_at" IS '手机端上报时间';
COMMENT ON COLUMN "agent_update_events"."tenant_id" IS '租户编号，当前默认 default';
COMMENT ON COLUMN "agent_update_events"."created_at" IS '创建时间';
COMMENT ON COLUMN "agent_update_events"."updated_at" IS '更新时间';
COMMENT ON COLUMN "agent_update_events"."created_by" IS '创建人或创建来源';
COMMENT ON COLUMN "agent_update_events"."updated_by" IS '更新人或更新来源';
COMMENT ON COLUMN "agent_update_events"."deleted_at" IS '软删除时间';

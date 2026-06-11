CREATE TABLE "collection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"device_id" uuid,
	"platform" varchar(32) NOT NULL,
	"scene_type" varchar(32) NOT NULL,
	"keyword" varchar(100),
	"matched_keywords" jsonb,
	"title_text" text,
	"subtitle_text" text,
	"metrics_text" text,
	"hot_comments_json" jsonb,
	"screen_text" text,
	"raw_payload" jsonb,
	"captured_at" timestamp with time zone,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "collection_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"platform" varchar(32) DEFAULT 'douyin' NOT NULL,
	"mode" varchar(32) DEFAULT 'search' NOT NULL,
	"search_keywords" jsonb NOT NULL,
	"match_keywords" jsonb NOT NULL,
	"video_minutes_min" integer DEFAULT 120 NOT NULL,
	"video_minutes_max" integer DEFAULT 180 NOT NULL,
	"live_minutes_min" integer DEFAULT 60 NOT NULL,
	"live_minutes_max" integer DEFAULT 120 NOT NULL,
	"collect_comments" boolean DEFAULT true NOT NULL,
	"comment_limit" integer DEFAULT 10 NOT NULL,
	"heartbeat_minutes" integer DEFAULT 15 NOT NULL,
	"status" varchar(32) DEFAULT 'ENABLED' NOT NULL,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "collector_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code" varchar(64) NOT NULL,
	"device_name" varchar(100),
	"platform" varchar(32),
	"app_version" varchar(64),
	"status" varchar(32) DEFAULT 'online' NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"device_id" uuid,
	"status" varchar(32) NOT NULL,
	"scene_type" varchar(32),
	"elapsed_minutes" integer,
	"remaining_minutes" integer,
	"viewed_count" integer,
	"captured_count" integer,
	"last_message" varchar(500),
	"reported_at" timestamp with time zone,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runtime_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"device_id" uuid,
	"level" varchar(16) NOT NULL,
	"message" varchar(500) NOT NULL,
	"context_json" jsonb,
	"stop_reason" varchar(64),
	"reported_at" timestamp with time zone,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_task_id_collection_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."collection_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_device_id_collector_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."collector_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD CONSTRAINT "device_heartbeats_task_id_collection_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."collection_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD CONSTRAINT "device_heartbeats_device_id_collector_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."collector_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_task_id_collection_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."collection_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_device_id_collector_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."collector_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_collection_records_tenant_created_at" ON "collection_records" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_collection_records_tenant_device_id" ON "collection_records" USING btree ("tenant_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_collection_tasks_tenant_task_code" ON "collection_tasks" USING btree ("tenant_id","task_code");--> statement-breakpoint
CREATE INDEX "idx_collection_tasks_tenant_status" ON "collection_tasks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_collector_devices_tenant_device_code" ON "collector_devices" USING btree ("tenant_id","device_code");--> statement-breakpoint
CREATE INDEX "idx_collector_devices_tenant_status" ON "collector_devices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_device_heartbeats_tenant_device_created_at" ON "device_heartbeats" USING btree ("tenant_id","device_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_runtime_logs_tenant_device_created_at" ON "runtime_logs" USING btree ("tenant_id","device_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_runtime_logs_tenant_level" ON "runtime_logs" USING btree ("tenant_id","level");
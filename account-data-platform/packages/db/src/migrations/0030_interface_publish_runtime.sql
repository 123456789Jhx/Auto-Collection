CREATE TABLE IF NOT EXISTS "publish_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL REFERENCES "remote_script_configs"("id"),
	"status" varchar(32) DEFAULT 'DRAFT' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"morning_window_start" varchar(5) DEFAULT '06:00' NOT NULL,
	"morning_window_end" varchar(5) DEFAULT '12:00' NOT NULL,
	"morning_publish_time" varchar(5) NOT NULL,
	"afternoon_window_start" varchar(5) DEFAULT '13:00' NOT NULL,
	"afternoon_window_end" varchar(5) DEFAULT '24:00' NOT NULL,
	"afternoon_publish_time" varchar(5) NOT NULL,
	"max_concurrent_publishing" integer DEFAULT 3 NOT NULL,
	"no_material_retry_minutes" integer DEFAULT 10 NOT NULL,
	"started_by" varchar(64) NOT NULL,
	"confirmed_by" varchar(64),
	"stop_requested_by" varchar(64),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"stop_requested_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_publish_runs_one_active_per_tenant" ON "publish_runs" ("tenant_id") WHERE "deleted_at" IS NULL AND "status" NOT IN ('STOPPED', 'FAILED', 'CANCELED');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_runs_tenant_status" ON "publish_runs" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_runs_tenant_config" ON "publish_runs" ("tenant_id", "config_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publish_run_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL REFERENCES "publish_runs"("id"),
	"binding_id" uuid NOT NULL REFERENCES "publish_account_bindings"("id"),
	"device_id" uuid NOT NULL REFERENCES "collector_devices"("id"),
	"device_code" varchar(64) NOT NULL,
	"platform" varchar(32) DEFAULT 'DOUYIN' NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"account_no" varchar(100) NOT NULL,
	"status" varchar(32) NOT NULL,
	"reservation_status" varchar(32) DEFAULT 'WAITING_DEVICE' NOT NULL,
	"assignment_id" uuid REFERENCES "device_task_assignments"("id"),
	"skipped_for_run" boolean DEFAULT false NOT NULL,
	"skip_reason" text,
	"reservation_reason" text,
	"next_reservation_retry_at" timestamp with time zone,
	"reserved_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_publish_run_bindings_run_binding" ON "publish_run_bindings" ("tenant_id", "run_id", "binding_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_publish_run_bindings_run_device" ON "publish_run_bindings" ("tenant_id", "run_id", "device_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_run_bindings_reservation" ON "publish_run_bindings" ("tenant_id", "run_id", "reservation_status", "next_reservation_retry_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_run_bindings_assignment" ON "publish_run_bindings" ("tenant_id", "assignment_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publish_slot_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL REFERENCES "publish_runs"("id"),
	"binding_id" uuid NOT NULL REFERENCES "publish_account_bindings"("id"),
	"business_date" date NOT NULL,
	"platform" varchar(32) DEFAULT 'DOUYIN' NOT NULL,
	"slot" varchar(16) NOT NULL,
	"status" varchar(32) DEFAULT 'WAITING' NOT NULL,
	"external_task_id" varchar(255),
	"claim_id" varchar(255),
	"publish_task_id" uuid REFERENCES "publish_tasks"("id"),
	"next_retry_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_category" varchar(64),
	"last_error" text,
	"side_effect_started_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_publish_slot_executions_daily_slot" ON "publish_slot_executions" ("tenant_id", "business_date", "platform", "binding_id", "slot");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_publish_slot_executions_external_task" ON "publish_slot_executions" ("tenant_id", "platform", "external_task_id") WHERE "external_task_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_slot_executions_run_status" ON "publish_slot_executions" ("tenant_id", "run_id", "status", "next_retry_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_slot_executions_publish_task" ON "publish_slot_executions" ("tenant_id", "publish_task_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publish_interface_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL REFERENCES "publish_runs"("id"),
	"slot_execution_id" uuid REFERENCES "publish_slot_executions"("id"),
	"code" varchar(100) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"message" text NOT NULL,
	"details_json" jsonb,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_interface_alerts_run_unread" ON "publish_interface_alerts" ("tenant_id", "run_id", "read_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_interface_alerts_slot" ON "publish_interface_alerts" ("tenant_id", "slot_execution_id");
--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN IF NOT EXISTS "interface_run_id" uuid REFERENCES "publish_runs"("id");
--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN IF NOT EXISTS "slot_execution_id" uuid REFERENCES "publish_slot_executions"("id");
--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN IF NOT EXISTS "local_result_status" varchar(32);
--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN IF NOT EXISTS "error_category" varchar(64);
--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN IF NOT EXISTS "side_effect_started_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_tasks_tenant_interface_run" ON "publish_tasks" ("tenant_id", "interface_run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_publish_tasks_tenant_slot_execution" ON "publish_tasks" ("tenant_id", "slot_execution_id") WHERE "slot_execution_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "publish_status_outbox" ADD COLUMN IF NOT EXISTS "target_status" varchar(32);
--> statement-breakpoint
ALTER TABLE "publish_status_outbox" ADD COLUMN IF NOT EXISTS "payload_json" jsonb;
--> statement-breakpoint
ALTER TABLE "publish_status_outbox" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "publish_status_outbox" ADD COLUMN IF NOT EXISTS "terminal_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_status_outbox_tenant_retry" ON "publish_status_outbox" ("tenant_id", "status", "next_retry_at");

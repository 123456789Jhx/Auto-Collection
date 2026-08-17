CREATE TABLE "publish_schedule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"config_id" uuid NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"status" varchar(32) DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"claimed_count" integer DEFAULT 0 NOT NULL,
	"dispatched_count" integer DEFAULT 0 NOT NULL,
	"reported_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_status_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"publish_task_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'REPORT_PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_attempted_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "source" varchar(32) DEFAULT 'EXTERNAL_PULL' NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "mode" varchar(32) DEFAULT 'IMMEDIATE' NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "report_mode" varchar(32) DEFAULT 'EXTERNAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "raw_payload" jsonb;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "batch_id" varchar(255);--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "report_status" varchar(32) DEFAULT 'REPORT_PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "report_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "report_last_error" text;--> statement-breakpoint
UPDATE "publish_tasks"
SET
  "scheduled_at" = "scheduled_slot",
  "mode" = CASE WHEN "scheduled_slot" IS NULL THEN "mode" ELSE 'SCHEDULED' END,
  "report_status" = CASE WHEN "reported_at" IS NULL THEN "report_status" ELSE 'REPORTED' END
WHERE "scheduled_slot" IS NOT NULL OR "reported_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_schedule_runs" ADD CONSTRAINT "publish_schedule_runs_config_id_remote_script_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."remote_script_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_status_outbox" ADD CONSTRAINT "publish_status_outbox_publish_task_id_publish_tasks_id_fk" FOREIGN KEY ("publish_task_id") REFERENCES "public"."publish_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_publish_schedule_runs_tenant_config_slot" ON "publish_schedule_runs" USING btree ("tenant_id","config_id","slot_at");--> statement-breakpoint
CREATE INDEX "idx_publish_schedule_runs_tenant_status_slot" ON "publish_schedule_runs" USING btree ("tenant_id","status","slot_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_publish_status_outbox_tenant_task" ON "publish_status_outbox" USING btree ("tenant_id","publish_task_id");--> statement-breakpoint
CREATE INDEX "idx_publish_status_outbox_tenant_status_created" ON "publish_status_outbox" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_publish_tasks_tenant_source_status" ON "publish_tasks" USING btree ("tenant_id","source","status");--> statement-breakpoint
CREATE INDEX "idx_publish_tasks_tenant_batch_id" ON "publish_tasks" USING btree ("tenant_id","batch_id");
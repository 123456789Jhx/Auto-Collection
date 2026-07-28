CREATE TABLE "publish_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"task_id" varchar(255) NOT NULL,
	"platform" varchar(32) NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text NOT NULL,
	"cover_url" text,
	"video_url" text NOT NULL,
	"status" varchar(32) DEFAULT 'CLAIMED' NOT NULL,
	"matched_device_id" uuid,
	"match_note" varchar(500),
	"scheduled_slot" timestamp with time zone,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD CONSTRAINT "publish_tasks_config_id_remote_script_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."remote_script_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD CONSTRAINT "publish_tasks_matched_device_id_collector_devices_id_fk" FOREIGN KEY ("matched_device_id") REFERENCES "public"."collector_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_publish_tasks_tenant_platform_task" ON "publish_tasks" USING btree ("tenant_id","platform","task_id");--> statement-breakpoint
CREATE INDEX "idx_publish_tasks_tenant_config_status" ON "publish_tasks" USING btree ("tenant_id","config_id","status");--> statement-breakpoint
CREATE INDEX "idx_publish_tasks_tenant_matched_device" ON "publish_tasks" USING btree ("tenant_id","matched_device_id");
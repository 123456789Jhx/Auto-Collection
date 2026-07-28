CREATE TABLE "mobile_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"device_id" uuid,
	"command_type" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"payload_json" jsonb,
	"result_json" jsonb,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mobile_commands" ADD CONSTRAINT "mobile_commands_task_id_collection_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."collection_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_commands" ADD CONSTRAINT "mobile_commands_device_id_collector_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."collector_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mobile_commands_tenant_device_status" ON "mobile_commands" USING btree ("tenant_id","device_id","status");--> statement-breakpoint
CREATE INDEX "idx_mobile_commands_tenant_created_at" ON "mobile_commands" USING btree ("tenant_id","created_at");
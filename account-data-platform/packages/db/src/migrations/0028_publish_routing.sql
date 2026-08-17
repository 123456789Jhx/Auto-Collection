CREATE TABLE "publish_account_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code" varchar(64) NOT NULL,
	"platform" varchar(32) NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"account_no" varchar(100),
	"enabled" boolean DEFAULT true NOT NULL,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "publish_claim_quarantines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code" varchar(64) NOT NULL,
	"platform" varchar(32) NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"reason" varchar(64) NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL,
	"last_external_task_id" varchar(255),
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "publish_device_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"device_code" varchar(64) NOT NULL,
	"platforms" jsonb NOT NULL,
	"time_windows" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "publish_device_schedules" ADD CONSTRAINT "publish_device_schedules_config_id_remote_script_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."remote_script_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_publish_account_bindings_active_account" ON "publish_account_bindings" USING btree ("tenant_id","platform","account_name") WHERE "publish_account_bindings"."enabled" = true and "publish_account_bindings"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_publish_account_bindings_active_device_platform" ON "publish_account_bindings" USING btree ("tenant_id","device_code","platform") WHERE "publish_account_bindings"."enabled" = true and "publish_account_bindings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_publish_account_bindings_tenant_device_platform" ON "publish_account_bindings" USING btree ("tenant_id","device_code","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_publish_claim_quarantines_tenant_lane" ON "publish_claim_quarantines" USING btree ("tenant_id","device_code","platform","account_name") WHERE "publish_claim_quarantines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_publish_claim_quarantines_tenant_blocked_until" ON "publish_claim_quarantines" USING btree ("tenant_id","blocked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_publish_device_schedules_tenant_config_device" ON "publish_device_schedules" USING btree ("tenant_id","config_id","device_code") WHERE "publish_device_schedules"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_publish_device_schedules_tenant_enabled" ON "publish_device_schedules" USING btree ("tenant_id","enabled","device_code");
CREATE TABLE "remote_script_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_key" varchar(64) NOT NULL,
	"config_name" varchar(100) NOT NULL,
	"config_payload" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"config_hash" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'ENABLED' NOT NULL,
	"remark" varchar(500),
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "remote_script_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_key" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"config_schema" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'ENABLED' NOT NULL,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "remote_script_device_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "remote_script_device_bindings" ADD CONSTRAINT "remote_script_device_bindings_config_id_remote_script_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."remote_script_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_script_device_bindings" ADD CONSTRAINT "remote_script_device_bindings_device_id_collector_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."collector_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_remote_script_configs_tenant_script_key_name" ON "remote_script_configs" USING btree ("tenant_id","script_key","config_name") WHERE "remote_script_configs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_remote_script_configs_tenant_script_key_status" ON "remote_script_configs" USING btree ("tenant_id","script_key","status");--> statement-breakpoint
CREATE INDEX "idx_remote_script_configs_tenant_created_at" ON "remote_script_configs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_remote_script_definitions_tenant_script_key" ON "remote_script_definitions" USING btree ("tenant_id","script_key") WHERE "remote_script_definitions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_remote_script_device_bindings_tenant_config" ON "remote_script_device_bindings" USING btree ("tenant_id","config_id");--> statement-breakpoint
CREATE INDEX "idx_remote_script_device_bindings_tenant_device" ON "remote_script_device_bindings" USING btree ("tenant_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_remote_script_device_bindings_tenant_config_device" ON "remote_script_device_bindings" USING btree ("tenant_id","config_id","device_id") WHERE "remote_script_device_bindings"."deleted_at" is null;
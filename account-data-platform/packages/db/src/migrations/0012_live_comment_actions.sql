CREATE TABLE IF NOT EXISTS "live_comment_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid REFERENCES "collection_tasks"("id"),
  "device_id" uuid REFERENCES "collector_devices"("id"),
  "trigger_event_id" varchar(128),
  "platform" varchar(32) DEFAULT 'douyin' NOT NULL,
  "room_name" varchar(200),
  "leader_account_name" varchar(200),
  "trigger_text" text,
  "matched_keywords" jsonb,
  "reply_text" text NOT NULL,
  "planned_delay_ms" integer,
  "status" varchar(32) NOT NULL,
  "skip_reason" varchar(200),
  "failure_reason" varchar(500),
  "raw_payload" jsonb,
  "planned_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "reported_at" timestamp with time zone,
  "tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" varchar(64) DEFAULT 'system' NOT NULL,
  "updated_by" varchar(64) DEFAULT 'system' NOT NULL,
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_live_comment_actions_tenant_device_created_at"
ON "live_comment_actions" ("tenant_id", "device_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_live_comment_actions_tenant_status"
ON "live_comment_actions" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "idx_live_comment_actions_tenant_task"
ON "live_comment_actions" ("tenant_id", "task_id");

ALTER TABLE "collection_tasks"
ADD COLUMN IF NOT EXISTS "live_comment_config" jsonb;

ALTER TABLE "collection_tasks"
ADD COLUMN IF NOT EXISTS "p3_extensions_config" jsonb;

ALTER TABLE "device_task_configs"
ADD COLUMN IF NOT EXISTS "live_comment_config" jsonb;

ALTER TABLE "device_task_configs"
ADD COLUMN IF NOT EXISTS "p3_extensions_config" jsonb;

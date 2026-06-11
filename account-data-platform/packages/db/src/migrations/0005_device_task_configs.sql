CREATE TABLE IF NOT EXISTS "device_task_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "video_minutes_min" integer DEFAULT 120 NOT NULL,
  "video_minutes_max" integer DEFAULT 180 NOT NULL,
  "live_minutes_min" integer DEFAULT 60 NOT NULL,
  "live_minutes_max" integer DEFAULT 120 NOT NULL,
  "collect_comments" boolean DEFAULT true NOT NULL,
  "comment_limit" integer DEFAULT 10 NOT NULL,
  "heartbeat_minutes" integer DEFAULT 1 NOT NULL,
  "tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" varchar(64) DEFAULT 'system' NOT NULL,
  "updated_by" varchar(64) DEFAULT 'system' NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "device_task_configs_device_id_collector_devices_id_fk"
    FOREIGN KEY ("device_id") REFERENCES "collector_devices"("id"),
  CONSTRAINT "device_task_configs_task_id_collection_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "collection_tasks"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_device_task_configs_tenant_device_task"
  ON "device_task_configs" ("tenant_id", "device_id", "task_id");

CREATE INDEX IF NOT EXISTS "idx_device_task_configs_tenant_device"
  ON "device_task_configs" ("tenant_id", "device_id");

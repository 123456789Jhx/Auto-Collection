CREATE TABLE IF NOT EXISTS "device_log_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid,
  "task_id" uuid,
  "log_date" varchar(10) NOT NULL,
  "file_name" varchar(200) NOT NULL,
  "content" text NOT NULL,
  "file_size_bytes" integer DEFAULT 0 NOT NULL,
  "info_count" integer DEFAULT 0 NOT NULL,
  "warn_count" integer DEFAULT 0 NOT NULL,
  "error_count" integer DEFAULT 0 NOT NULL,
  "last_error_reason" varchar(500),
  "uploaded_at" timestamp with time zone,
  "tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" varchar(64) DEFAULT 'system' NOT NULL,
  "updated_by" varchar(64) DEFAULT 'system' NOT NULL,
  "deleted_at" timestamp with time zone
);

ALTER TABLE "device_log_files"
ADD CONSTRAINT "device_log_files_device_id_collector_devices_id_fk"
FOREIGN KEY ("device_id") REFERENCES "collector_devices"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "device_log_files"
ADD CONSTRAINT "device_log_files_task_id_collection_tasks_id_fk"
FOREIGN KEY ("task_id") REFERENCES "collection_tasks"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "idx_device_log_files_tenant_device_date"
ON "device_log_files" USING btree ("tenant_id","device_id","log_date");

CREATE INDEX IF NOT EXISTS "idx_device_log_files_tenant_created_at"
ON "device_log_files" USING btree ("tenant_id","created_at");

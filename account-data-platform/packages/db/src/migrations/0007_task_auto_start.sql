ALTER TABLE "collection_tasks"
ADD COLUMN IF NOT EXISTS "auto_start" boolean NOT NULL DEFAULT false;

ALTER TABLE "device_task_configs"
ADD COLUMN IF NOT EXISTS "auto_start" boolean NOT NULL DEFAULT false;

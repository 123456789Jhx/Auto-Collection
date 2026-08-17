ALTER TABLE "collector_devices"
  ADD COLUMN IF NOT EXISTS "base_offline_threshold_seconds" integer DEFAULT 15 NOT NULL;

ALTER TABLE "collector_devices"
  DROP CONSTRAINT IF EXISTS "collector_devices_base_offline_threshold_seconds_check";

ALTER TABLE "collector_devices"
  ADD CONSTRAINT "collector_devices_base_offline_threshold_seconds_check"
  CHECK ("base_offline_threshold_seconds" BETWEEN 15 AND 150);

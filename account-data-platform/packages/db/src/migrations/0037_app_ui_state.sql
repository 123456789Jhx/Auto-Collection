ALTER TABLE "collector_devices"
  ADD COLUMN IF NOT EXISTS "app_ui_state" varchar(32) DEFAULT 'unknown' NOT NULL;

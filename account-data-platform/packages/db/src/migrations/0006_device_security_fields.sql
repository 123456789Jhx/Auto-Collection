ALTER TABLE "collector_devices"
  ADD COLUMN IF NOT EXISTS "device_token" varchar(128),
  ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "last_ip" varchar(64),
  ADD COLUMN IF NOT EXISTS "last_region" varchar(100),
  ADD COLUMN IF NOT EXISTS "remark" varchar(500);

CREATE INDEX IF NOT EXISTS "idx_collector_devices_tenant_enabled"
  ON "collector_devices" ("tenant_id", "enabled");

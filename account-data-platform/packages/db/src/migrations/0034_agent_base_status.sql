ALTER TABLE "collector_devices"
  ADD COLUMN IF NOT EXISTS "base_status" varchar(32) DEFAULT 'unknown' NOT NULL,
  ADD COLUMN IF NOT EXISTS "base_last_heartbeat_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "screen_state" varchar(32) DEFAULT 'unknown' NOT NULL,
  ADD COLUMN IF NOT EXISTS "desired_agent_state" varchar(32) DEFAULT 'running' NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_collector_devices_tenant_base_status"
  ON "collector_devices" ("tenant_id", "base_status");

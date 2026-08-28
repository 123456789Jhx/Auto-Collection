ALTER TABLE "collector_devices"
  ADD COLUMN IF NOT EXISTS "agent_lifecycle_state" varchar(24) NOT NULL DEFAULT 'RUNNING',
  ADD COLUMN IF NOT EXISTS "polling_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "agent_state_reason" varchar(64),
  ADD COLUMN IF NOT EXISTS "agent_state_changed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "agent_session_id" varchar(128);

ALTER TABLE "mobile_commands"
  ADD COLUMN IF NOT EXISTS "executor_type" varchar(16) DEFAULT 'AGENT' NOT NULL,
  ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "claim_token" varchar(64);

UPDATE "mobile_commands"
SET "executor_type" = 'BASE'
WHERE "command_type" IN ('START_AGENT', 'STOP_AGENT', 'OPEN_AGENT_APP')
  AND "executor_type" <> 'BASE';

CREATE INDEX IF NOT EXISTS "idx_mobile_commands_executor_pending"
  ON "mobile_commands" ("tenant_id", "device_id", "executor_type", "status", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_mobile_commands_active_executor_channel"
  ON "mobile_commands" ("tenant_id", "device_id", "executor_type")
  WHERE "status" IN ('CLAIMED', 'RUNNING') AND "deleted_at" IS NULL;

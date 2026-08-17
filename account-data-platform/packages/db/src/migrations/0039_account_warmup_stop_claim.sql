-- Allow the Agent to receive a scoped stop control message while the
-- corresponding ACCOUNT_WARMUP_RUN remains claimed or running.
DROP INDEX IF EXISTS "uniq_mobile_commands_active_executor_channel";

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_mobile_commands_active_executor_channel"
  ON "mobile_commands" ("tenant_id", "device_id", "executor_type")
  WHERE "status" IN ('CLAIMED', 'RUNNING')
    AND "command_type" <> 'ACCOUNT_WARMUP_STOP'
    AND "deleted_at" IS NULL;

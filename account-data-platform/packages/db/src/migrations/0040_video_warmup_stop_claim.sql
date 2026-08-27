-- Allow video warmup stop controls to coexist with the active Agent run.
DROP INDEX IF EXISTS "uniq_mobile_commands_active_executor_channel";

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_mobile_commands_active_executor_channel"
  ON "mobile_commands" ("tenant_id", "device_id", "executor_type")
  WHERE "status" IN ('CLAIMED', 'RUNNING')
    AND "command_type" NOT IN ('ACCOUNT_WARMUP_STOP', 'VIDEO_WARMUP_STOP')
    AND "deleted_at" IS NULL;

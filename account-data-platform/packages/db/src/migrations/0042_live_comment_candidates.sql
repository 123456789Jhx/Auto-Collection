CREATE TABLE IF NOT EXISTS "live_comment_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "task_id" uuid REFERENCES "collection_tasks"("id"),
  "command_id" uuid NOT NULL REFERENCES "mobile_commands"("id"),
  "device_id" uuid NOT NULL REFERENCES "collector_devices"("id"),
  "comment_text" varchar(100) NOT NULL,
  "normalized_value" text NOT NULL,
  "sources_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'PENDING',
  "vocabulary_entry_id" uuid REFERENCES "account_warmup_vocabulary"("id"),
  "imported_at" timestamptz,
  "tenant_id" varchar(64) NOT NULL DEFAULT 'default',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" varchar(64) NOT NULL DEFAULT 'system',
  "updated_by" varchar(64) NOT NULL DEFAULT 'system',
  "deleted_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_live_comment_candidates_tenant_batch_normalized"
  ON "live_comment_candidates" ("tenant_id", "batch_id", "normalized_value");
CREATE INDEX IF NOT EXISTS "idx_live_comment_candidates_tenant_batch_status"
  ON "live_comment_candidates" ("tenant_id", "batch_id", "status");

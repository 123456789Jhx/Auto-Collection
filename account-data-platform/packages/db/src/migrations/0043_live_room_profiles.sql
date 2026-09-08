CREATE TABLE IF NOT EXISTS "live_room_captures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "device_id" uuid NOT NULL REFERENCES "collector_devices"("id"),
  "command_id" uuid NOT NULL REFERENCES "mobile_commands"("id"),
  "room_key" varchar(200) NOT NULL,
  "account_id" varchar(100),
  "account_name" varchar(200),
  "room_name" varchar(200),
  "viewer_count" integer,
  "capture_status" varchar(64) NOT NULL DEFAULT 'CAPTURED',
  "capture_completed" boolean NOT NULL DEFAULT true,
  "captured_at" timestamptz,
  "completed_at" timestamptz,
  "raw_ocr_text" text,
  "raw_ocr_pages" jsonb,
  "raw_comments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tenant_id" varchar(64) NOT NULL DEFAULT 'default',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" varchar(64) NOT NULL DEFAULT 'system',
  "updated_by" varchar(64) NOT NULL DEFAULT 'system',
  "deleted_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_live_room_captures_tenant_batch_device_room"
  ON "live_room_captures" ("tenant_id", "batch_id", "device_id", "room_key");
CREATE INDEX IF NOT EXISTS "idx_live_room_captures_tenant_batch_device"
  ON "live_room_captures" ("tenant_id", "batch_id", "device_id");
CREATE INDEX IF NOT EXISTS "idx_live_room_captures_tenant_room"
  ON "live_room_captures" ("tenant_id", "room_key");

CREATE TABLE IF NOT EXISTS "live_room_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "capture_id" uuid NOT NULL REFERENCES "live_room_captures"("id"),
  "status" varchar(16) NOT NULL DEFAULT 'PENDING',
  "provider" varchar(64),
  "model" varchar(100),
  "summary" text,
  "audience_features" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "interest_needs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "interaction_traits" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "evidence_comments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "confidence" varchar(32),
  "confidence_explanation" text,
  "error_message" text,
  "completed_at" timestamptz,
  "tenant_id" varchar(64) NOT NULL DEFAULT 'default',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" varchar(64) NOT NULL DEFAULT 'system',
  "updated_by" varchar(64) NOT NULL DEFAULT 'system',
  "deleted_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_live_room_profiles_tenant_capture"
  ON "live_room_profiles" ("tenant_id", "capture_id");
CREATE INDEX IF NOT EXISTS "idx_live_room_profiles_tenant_status"
  ON "live_room_profiles" ("tenant_id", "status");

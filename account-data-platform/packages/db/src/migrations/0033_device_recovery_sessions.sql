CREATE TABLE IF NOT EXISTS "device_recovery_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
  "device_id" uuid NOT NULL,
  "command_id" uuid,
  "boot_id" varchar(128),
  "source" varchar(32) NOT NULL,
  "channel" varchar(32),
  "stage" varchar(32) DEFAULT 'WAITING_DEVICE' NOT NULL,
  "result_status" varchar(32),
  "error_code" varchar(64),
  "error_message" varchar(500),
  "started_at" timestamp with time zone NOT NULL,
  "last_stage_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" varchar(64) DEFAULT 'system' NOT NULL,
  "updated_by" varchar(64) DEFAULT 'system' NOT NULL,
  CONSTRAINT "device_recovery_session_device_fk"
    FOREIGN KEY ("device_id") REFERENCES "collector_devices"("id"),
  CONSTRAINT "device_recovery_session_command_fk"
    FOREIGN KEY ("command_id") REFERENCES "mobile_commands"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_device_recovery_session_command"
  ON "device_recovery_sessions" ("tenant_id", "command_id")
  WHERE "command_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_device_recovery_session_boot"
  ON "device_recovery_sessions" ("tenant_id", "device_id", "boot_id")
  WHERE "boot_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_device_recovery_session_device_started"
  ON "device_recovery_sessions" ("tenant_id", "device_id", "started_at");

CREATE INDEX IF NOT EXISTS "idx_device_recovery_session_active_stage"
  ON "device_recovery_sessions" ("tenant_id", "result_status", "stage", "last_stage_at");

CREATE TABLE IF NOT EXISTS "device_recovery_stage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
  "session_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "event_key" varchar(200) NOT NULL,
  "stage" varchar(32) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "reported_at" timestamp with time zone NOT NULL,
  "details_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" varchar(64) DEFAULT 'system' NOT NULL,
  "updated_by" varchar(64) DEFAULT 'system' NOT NULL,
  CONSTRAINT "device_recovery_stage_event_session_fk"
    FOREIGN KEY ("session_id") REFERENCES "device_recovery_sessions"("id"),
  CONSTRAINT "device_recovery_stage_event_device_fk"
    FOREIGN KEY ("device_id") REFERENCES "collector_devices"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_device_recovery_stage_event_key"
  ON "device_recovery_stage_events" ("tenant_id", "device_id", "event_key");

CREATE INDEX IF NOT EXISTS "idx_device_recovery_stage_event_session_occurred"
  ON "device_recovery_stage_events" ("tenant_id", "session_id", "occurred_at");

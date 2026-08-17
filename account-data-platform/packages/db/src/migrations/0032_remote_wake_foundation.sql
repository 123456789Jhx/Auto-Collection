CREATE TABLE IF NOT EXISTS "device_remote_wake_push_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
  "device_id" uuid NOT NULL,
  "provider" varchar(32) DEFAULT 'XIAOMI_PUSH' NOT NULL,
  "registration_id" varchar(512) NOT NULL,
  "app_version" varchar(64),
  "enabled" boolean DEFAULT true NOT NULL,
  "last_registered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "remote_wake_push_channel_device_fk"
    FOREIGN KEY ("device_id") REFERENCES "collector_devices"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_remote_wake_push_channel_device_provider"
  ON "device_remote_wake_push_channels" ("tenant_id", "device_id", "provider")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_remote_wake_push_channel_registration"
  ON "device_remote_wake_push_channels" ("tenant_id", "provider", "registration_id");

CREATE TABLE IF NOT EXISTS "remote_wake_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
  "command_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "channel" varchar(32) NOT NULL,
  "stage" varchar(32) DEFAULT 'CREATED' NOT NULL,
  "result_status" varchar(32),
  "error_code" varchar(64),
  "error_message" varchar(500),
  "ack_token_hash" varchar(64),
  "push_message_id" varchar(160),
  "issued_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "device_received_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "remote_wake_attempt_command_fk"
    FOREIGN KEY ("command_id") REFERENCES "mobile_commands"("id"),
  CONSTRAINT "remote_wake_attempt_device_fk"
    FOREIGN KEY ("device_id") REFERENCES "collector_devices"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_remote_wake_attempt_command"
  ON "remote_wake_attempts" ("tenant_id", "command_id");

CREATE INDEX IF NOT EXISTS "idx_remote_wake_attempt_device_created"
  ON "remote_wake_attempts" ("tenant_id", "device_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_remote_wake_attempt_stage_expiry"
  ON "remote_wake_attempts" ("tenant_id", "stage", "expires_at");

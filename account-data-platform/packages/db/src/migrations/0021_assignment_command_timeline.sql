ALTER TABLE mobile_commands
  ADD COLUMN IF NOT EXISTS assignment_id uuid;

ALTER TABLE mobile_commands
  ADD COLUMN IF NOT EXISTS command_sequence integer;

ALTER TABLE mobile_commands
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(160);

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS start_command_id uuid;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS selected_target_id uuid;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS target_code varchar(64);

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS config_revision integer;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS config_hash varchar(64);

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS config_snapshot jsonb;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS snapshot_hash varchar(64);

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS execution_approval_id uuid;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS expected_account_id varchar(100);

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS expected_account_name varchar(100);

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS current_stage varchar(64);

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS progress_json jsonb;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS started_at timestamp with time zone;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS last_event_seq integer;

UPDATE device_task_assignments
SET last_event_seq = 0
WHERE last_event_seq IS NULL;

ALTER TABLE device_task_assignments
  ALTER COLUMN last_event_seq SET DEFAULT 0,
  ALTER COLUMN last_event_seq SET NOT NULL;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS state_version integer;

UPDATE device_task_assignments
SET state_version = 1
WHERE state_version IS NULL;

ALTER TABLE device_task_assignments
  ALTER COLUMN state_version SET DEFAULT 1,
  ALTER COLUMN state_version SET NOT NULL;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS block_reason varchar(200);

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS terminal_reason varchar(200);

UPDATE device_task_assignments
SET start_command_id = command_id
WHERE start_command_id IS NULL
  AND command_id IS NOT NULL
  AND status NOT IN ('STOPPED', 'SUPERSEDED', 'CANCELLED', 'FAILED', 'COMPLETED', 'EXPIRED');

UPDATE mobile_commands AS command
SET assignment_id = assignment.id,
    command_sequence = 1,
    idempotency_key = concat('assignment:', assignment.id::text, ':command:1')
FROM device_task_assignments AS assignment
WHERE command.id = assignment.command_id
  AND command.assignment_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_commands_tenant_assignment
  ON mobile_commands (tenant_id, assignment_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_mobile_commands_tenant_assignment_sequence
  ON mobile_commands (tenant_id, assignment_id, command_sequence)
  WHERE assignment_id IS NOT NULL
    AND command_sequence IS NOT NULL
    AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_mobile_commands_tenant_idempotency_key
  ON mobile_commands (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_device_task_assignments_tenant_target
  ON device_task_assignments (tenant_id, selected_target_id);

CREATE INDEX IF NOT EXISTS idx_device_task_assignments_tenant_snapshot
  ON device_task_assignments (tenant_id, snapshot_hash);

WITH ranked_active_assignments AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, device_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM device_task_assignments
  WHERE deleted_at IS NULL
    AND status NOT IN ('STOPPED', 'SUPERSEDED', 'CANCELLED', 'FAILED', 'COMPLETED', 'EXPIRED')
)
UPDATE device_task_assignments AS assignment
SET status = 'SUPERSEDED',
    reason = 'superseded_by_assignment_uniqueness_backfill',
    terminal_reason = 'superseded_by_assignment_uniqueness_backfill',
    completed_at = coalesce(assignment.completed_at, now()),
    updated_at = now(),
    updated_by = 'migration'
FROM ranked_active_assignments AS ranked
WHERE assignment.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_device_task_assignments_one_active_per_device
  ON device_task_assignments (tenant_id, device_id)
  WHERE deleted_at IS NULL
    AND status NOT IN ('STOPPED', 'SUPERSEDED', 'CANCELLED', 'FAILED', 'COMPLETED', 'EXPIRED');

CREATE TABLE IF NOT EXISTS device_task_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES device_task_assignments(id),
  sequence integer NOT NULL,
  device_id uuid NOT NULL REFERENCES collector_devices(id),
  target_id uuid REFERENCES live_targets(id),
  feature_type varchar(64) NOT NULL,
  stage varchar(64),
  event_type varchar(100) NOT NULL,
  from_state varchar(32),
  to_state varchar(32),
  status varchar(32) NOT NULL,
  reason_code varchar(100),
  idempotency_key varchar(200) NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  actor varchar(32) NOT NULL DEFAULT 'system',
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_device_task_assignment_events_tenant_assignment_seq
  ON device_task_assignment_events (tenant_id, assignment_id, sequence);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_device_task_assignment_events_tenant_idempotency
  ON device_task_assignment_events (tenant_id, idempotency_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_device_task_assignment_events_tenant_device_occurred
  ON device_task_assignment_events (tenant_id, device_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_device_task_assignment_events_tenant_assignment
  ON device_task_assignment_events (tenant_id, assignment_id);

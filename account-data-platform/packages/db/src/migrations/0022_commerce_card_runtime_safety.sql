ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS workflow_version integer;

UPDATE device_task_assignments
SET workflow_version = 1
WHERE workflow_version IS NULL;

ALTER TABLE device_task_assignments
  ALTER COLUMN workflow_version SET DEFAULT 1,
  ALTER COLUMN workflow_version SET NOT NULL;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS checkpoint_sequence integer;

UPDATE device_task_assignments
SET checkpoint_sequence = 0
WHERE checkpoint_sequence IS NULL;

ALTER TABLE device_task_assignments
  ALTER COLUMN checkpoint_sequence SET DEFAULT 0,
  ALTER COLUMN checkpoint_sequence SET NOT NULL;

ALTER TABLE device_task_assignments
  ADD COLUMN IF NOT EXISTS checkpoint_hash varchar(64),
  ADD COLUMN IF NOT EXISTS checkpoint_summary jsonb;

DROP INDEX IF EXISTS uniq_device_task_assignments_one_active_per_device;

UPDATE device_task_assignments
SET status = CASE status
  WHEN 'ISSUED' THEN 'DISPATCHED'
  WHEN 'ACKED' THEN 'RUNNING'
  WHEN 'ACTIVE' THEN 'RUNNING'
  WHEN 'STOPPED' THEN 'CANCELLED'
  WHEN 'SUPERSEDED' THEN 'CANCELLED'
  WHEN 'COMPLETED' THEN 'SUCCEEDED'
  WHEN 'STOPPING' THEN 'BLOCKED'
  ELSE status
END,
    terminal_reason = CASE
      WHEN status = 'SUPERSEDED' THEN coalesce(terminal_reason, 'superseded_legacy_assignment')
      WHEN status = 'STOPPED' THEN coalesce(terminal_reason, 'stopped_legacy_assignment')
      ELSE terminal_reason
    END,
    block_reason = CASE
      WHEN status = 'STOPPING' THEN coalesce(block_reason, 'legacy_stop_pending')
      ELSE block_reason
    END
WHERE status IN ('ISSUED', 'ACKED', 'ACTIVE', 'STOPPED', 'SUPERSEDED', 'COMPLETED', 'STOPPING');

CREATE UNIQUE INDEX uniq_device_task_assignments_one_active_per_device
  ON device_task_assignments (tenant_id, device_id)
  WHERE deleted_at IS NULL
    AND status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'STOPPED', 'SUPERSEDED', 'COMPLETED');

ALTER TABLE device_task_assignment_events
  ADD COLUMN IF NOT EXISTS payload_hash varchar(64);

UPDATE device_task_assignment_events
SET payload_hash = md5(concat_ws(':', assignment_id::text, sequence::text, idempotency_key, coalesce(event_type, ''), coalesce(evidence_json::text, ''))) ||
                   md5(concat_ws(':', coalesce(from_state, ''), coalesce(to_state, ''), coalesce(status, ''), coalesce(reason_code, '')))
WHERE payload_hash IS NULL;

ALTER TABLE device_task_assignment_events
  ALTER COLUMN payload_hash SET NOT NULL;

CREATE TABLE IF NOT EXISTS commerce_card_execution_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES live_targets(id),
  device_id uuid NOT NULL REFERENCES collector_devices(id),
  expected_account_id varchar(100),
  expected_account_name varchar(100),
  config_hash varchar(64) NOT NULL,
  comment_pool_hash varchar(64) NOT NULL,
  max_comments_per_room integer NOT NULL,
  total_quota integer NOT NULL,
  consumed_quota integer NOT NULL DEFAULT 0,
  account_daily_limit integer NOT NULL,
  target_daily_limit integer NOT NULL,
  cooldown_seconds integer NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  revision integer NOT NULL DEFAULT 1,
  valid_from timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  approved_by varchar(64) NOT NULL,
  approved_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_by varchar(64),
  revoked_at timestamp with time zone,
  revoke_reason varchar(500),
  reason varchar(500) NOT NULL,
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_commerce_card_approvals_tenant_status_expiry
  ON commerce_card_execution_approvals (tenant_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_commerce_card_approvals_tenant_device_target
  ON commerce_card_execution_approvals (tenant_id, device_id, target_id);

CREATE INDEX IF NOT EXISTS idx_commerce_card_approvals_tenant_config_hash
  ON commerce_card_execution_approvals (tenant_id, config_hash);

ALTER TABLE live_comment_actions
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES device_task_assignments(id),
  ADD COLUMN IF NOT EXISTS target_id uuid REFERENCES live_targets(id),
  ADD COLUMN IF NOT EXISTS approval_id uuid REFERENCES commerce_card_execution_approvals(id),
  ADD COLUMN IF NOT EXISTS assignment_event_id uuid REFERENCES device_task_assignment_events(id),
  ADD COLUMN IF NOT EXISTS stage varchar(64),
  ADD COLUMN IF NOT EXISTS expected_account_id varchar(100),
  ADD COLUMN IF NOT EXISTS expected_account_name varchar(100),
  ADD COLUMN IF NOT EXISTS room_key_version integer,
  ADD COLUMN IF NOT EXISTS room_key varchar(200),
  ADD COLUMN IF NOT EXISTS comment_slot integer,
  ADD COLUMN IF NOT EXISTS comment_hash varchar(64),
  ADD COLUMN IF NOT EXISTS attempt_no integer,
  ADD COLUMN IF NOT EXISTS action_state varchar(32),
  ADD COLUMN IF NOT EXISTS state_version integer,
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(220),
  ADD COLUMN IF NOT EXISTS permit_token_hash varchar(64),
  ADD COLUMN IF NOT EXISTS permit_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS submitted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS resolved_by varchar(64),
  ADD COLUMN IF NOT EXISTS resolved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS resolution_evidence varchar(1000);

UPDATE live_comment_actions
SET attempt_no = coalesce(attempt_no, 1),
    action_state = coalesce(action_state, status),
    state_version = coalesce(state_version, 1)
WHERE attempt_no IS NULL
   OR action_state IS NULL
   OR state_version IS NULL;

ALTER TABLE live_comment_actions
  ALTER COLUMN attempt_no SET DEFAULT 1,
  ALTER COLUMN attempt_no SET NOT NULL,
  ALTER COLUMN state_version SET DEFAULT 1,
  ALTER COLUMN state_version SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_live_comment_actions_tenant_assignment
  ON live_comment_actions (tenant_id, assignment_id);

CREATE INDEX IF NOT EXISTS idx_live_comment_actions_tenant_approval
  ON live_comment_actions (tenant_id, approval_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_comment_actions_tenant_idempotency
  ON live_comment_actions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_comment_actions_physical_slot
  ON live_comment_actions (
    tenant_id,
    assignment_id,
    target_id,
    expected_account_id,
    room_key_version,
    room_key,
    comment_slot
  )
  WHERE assignment_id IS NOT NULL
    AND target_id IS NOT NULL
    AND expected_account_id IS NOT NULL
    AND room_key_version IS NOT NULL
    AND room_key IS NOT NULL
    AND comment_slot IS NOT NULL;

CREATE TABLE IF NOT EXISTS commerce_card_approval_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES commerce_card_execution_approvals(id),
  assignment_id uuid NOT NULL REFERENCES device_task_assignments(id),
  action_id uuid NOT NULL REFERENCES live_comment_actions(id),
  device_id uuid NOT NULL REFERENCES collector_devices(id),
  target_id uuid NOT NULL REFERENCES live_targets(id),
  expected_account_id varchar(100) NOT NULL,
  amount integer NOT NULL DEFAULT 1,
  consumed_at timestamp with time zone NOT NULL DEFAULT now(),
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_commerce_card_approval_consumption_action
  ON commerce_card_approval_consumptions (tenant_id, action_id);

CREATE INDEX IF NOT EXISTS idx_commerce_card_approval_consumptions_approval
  ON commerce_card_approval_consumptions (tenant_id, approval_id, consumed_at);

CREATE INDEX IF NOT EXISTS idx_commerce_card_approval_consumptions_account
  ON commerce_card_approval_consumptions (tenant_id, expected_account_id, consumed_at);

CREATE INDEX IF NOT EXISTS idx_commerce_card_approval_consumptions_target
  ON commerce_card_approval_consumptions (tenant_id, target_id, consumed_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mobile_commands_assignment_id_fkey'
  ) THEN
    ALTER TABLE mobile_commands
      ADD CONSTRAINT mobile_commands_assignment_id_fkey
      FOREIGN KEY (assignment_id) REFERENCES device_task_assignments(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'device_task_assignments_execution_approval_id_fkey'
  ) THEN
    ALTER TABLE device_task_assignments
      ADD CONSTRAINT device_task_assignments_execution_approval_id_fkey
      FOREIGN KEY (execution_approval_id) REFERENCES commerce_card_execution_approvals(id);
  END IF;
END $$;

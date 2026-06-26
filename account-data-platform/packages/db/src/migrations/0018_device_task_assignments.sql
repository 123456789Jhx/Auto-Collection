CREATE TABLE IF NOT EXISTS device_task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES collector_devices(id),
  task_id uuid REFERENCES collection_tasks(id),
  command_id uuid REFERENCES mobile_commands(id),
  task_type varchar(32) NOT NULL,
  target_context varchar(64),
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  priority integer NOT NULL DEFAULT 100,
  source varchar(64) NOT NULL DEFAULT 'manual',
  reason varchar(200),
  desired_payload jsonb,
  issued_at timestamp with time zone,
  acknowledged_at timestamp with time zone,
  expires_at timestamp with time zone,
  completed_at timestamp with time zone,
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_device_task_assignments_tenant_device_created_at
  ON device_task_assignments (tenant_id, device_id, created_at);

CREATE INDEX IF NOT EXISTS idx_device_task_assignments_tenant_status
  ON device_task_assignments (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_device_task_assignments_tenant_command
  ON device_task_assignments (tenant_id, command_id);

UPDATE "mobile_commands"
SET "executor_type" = 'BASE'
WHERE "command_type" = 'EXIT_AGENT_APP'
  AND "executor_type" <> 'BASE';

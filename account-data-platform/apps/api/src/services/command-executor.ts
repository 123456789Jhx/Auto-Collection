export const COMMAND_EXECUTORS = ["BASE", "AGENT"] as const;

export type CommandExecutor = typeof COMMAND_EXECUTORS[number];

const BASE_COMMAND_TYPES = new Set(["START_AGENT", "STOP_AGENT", "OPEN_AGENT_APP", "EXIT_AGENT_APP"]);

export function executorForCommandType(commandType: string): CommandExecutor {
  return BASE_COMMAND_TYPES.has(commandType) ? "BASE" : "AGENT";
}

export function isCommandExecutor(value: unknown): value is CommandExecutor {
  return typeof value === "string" && COMMAND_EXECUTORS.includes(value as CommandExecutor);
}

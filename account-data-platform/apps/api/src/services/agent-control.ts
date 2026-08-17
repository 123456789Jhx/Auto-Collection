const AGENT_CONTROL_COMMAND_TYPES = ["OPEN_AGENT_APP", "START_AGENT", "STOP_AGENT"] as const;

export type AgentControlCommandType = typeof AGENT_CONTROL_COMMAND_TYPES[number];
export type DesiredAgentState = "running" | "stopped";

export function isAgentControlCommand(commandType: string): commandType is AgentControlCommandType {
  return AGENT_CONTROL_COMMAND_TYPES.includes(commandType as AgentControlCommandType);
}

export function desiredAgentStateForCommand(commandType: string): DesiredAgentState | null {
  if (commandType === "START_AGENT") return "running";
  if (commandType === "STOP_AGENT") return "stopped";
  return null;
}

export function supersededAgentControlCommandsFor(commandType: string): AgentControlCommandType[] {
  return isAgentControlCommand(commandType) ? [...AGENT_CONTROL_COMMAND_TYPES] : [];
}

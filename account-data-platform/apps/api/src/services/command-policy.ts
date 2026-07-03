const STATE_COMMAND_TYPES = ["START", "RESUME", "PAUSE", "STOP"] as const;

export type StateCommandType = typeof STATE_COMMAND_TYPES[number];

export function isStateCommandType(commandType: string): commandType is StateCommandType {
  return STATE_COMMAND_TYPES.includes(commandType as StateCommandType);
}

export function supersededCommandTypesFor(commandType: string) {
  if (!isStateCommandType(commandType)) {
    return [];
  }
  if (commandType === "STOP") {
    return [...STATE_COMMAND_TYPES];
  }
  return STATE_COMMAND_TYPES.filter((item) => item !== "STOP");
}

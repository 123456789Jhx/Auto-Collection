export type RemoteWakeCommandType = "OPEN_AGENT_APP" | "START_AGENT";
export type ExitAgentAppCommandType = "EXIT_AGENT_APP";

export type RemoteWakeDeviceState = {
  baseReachable?: boolean;
  baseStatus?: string;
  baseConnectivityStatus?: "ONLINE" | "RECONNECTING" | "OFFLINE";
  agentReachable?: boolean;
  screenState?: string;
  appUiState?: string;
};

export type RemoteWakeActionPlan = {
  kind: "confirm" | "ready" | "unavailable";
  title: string;
  content: string;
  commandType: RemoteWakeCommandType | null;
};

export type ExitAgentAppActionPlan = {
  kind: "confirm" | "info";
  title: string;
  content: string;
  commandType: ExitAgentAppCommandType | null;
  defaultLockScreen: boolean;
};

export type ExitAgentAppCommandView = {
  id: string;
  deviceId: string;
  commandType: string;
  status: string;
  resultJson?: {
    result?: string;
    stages?: Array<{
      name?: string;
      status?: string;
      reason?: string | null;
    }>;
  } | null;
};

type ExitCommandStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const exitCommandStorageKey = "remote-wake-exit-command-ids";

function browserStorage(): ExitCommandStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readExitCommandMap(storage: ExitCommandStorage | null) {
  if (!storage) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(storage.getItem(exitCommandStorageKey) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<string, string>;
    return Object.fromEntries(Object.entries(parsed).flatMap(([deviceCode, commandId]) => {
      const normalizedDeviceCode = deviceCode.trim();
      const normalizedCommandId = typeof commandId === "string" ? commandId.trim() : "";
      return normalizedDeviceCode && normalizedCommandId ? [[normalizedDeviceCode, normalizedCommandId]] : [];
    }));
  } catch {
    return {} as Record<string, string>;
  }
}

export function readExitAgentAppCommandId(deviceCode: string, storage = browserStorage()) {
  const key = deviceCode.trim();
  return key ? readExitCommandMap(storage)[key] ?? "" : "";
}

export function writeExitAgentAppCommandId(
  deviceCode: string,
  commandId: string,
  storage = browserStorage()
) {
  if (!storage) return;
  try {
    const key = deviceCode.trim();
    const value = commandId.trim();
    if (!key) return;
    const commandIds = readExitCommandMap(storage);
    if (value) commandIds[key] = value;
    else delete commandIds[key];
    if (Object.keys(commandIds).length > 0) storage.setItem(exitCommandStorageKey, JSON.stringify(commandIds));
    else storage.removeItem(exitCommandStorageKey);
  } catch {
    // Exit commands must still succeed when browser persistence is unavailable.
  }
}

export function selectExitAgentAppCommand(
  commands: ExitAgentAppCommandView[],
  commandId: string,
  device: { id?: string; deviceCode: string }
) {
  const normalizedCommandId = commandId.trim();
  if (!normalizedCommandId) return null;
  const command = commands.find((candidate) => candidate.id === normalizedCommandId);
  if (!command || command.commandType !== "EXIT_AGENT_APP") return null;
  const deviceKeys = [device.id, device.deviceCode].filter((value): value is string => Boolean(value && value.trim()));
  return deviceKeys.includes(command.deviceId) ? command : null;
}

export function isExitAgentAppCommandActive(command: ExitAgentAppCommandView) {
  return ["PENDING", "FETCHED", "CLAIMED", "RUNNING"].includes(command.status);
}

export function findActiveExitAgentAppCommand(
  commands: ExitAgentAppCommandView[],
  device: { id?: string; deviceCode: string }
) {
  const deviceKeys = [device.id, device.deviceCode].filter((value): value is string => Boolean(value && value.trim()));
  return commands.find((command) =>
    command.commandType === "EXIT_AGENT_APP" &&
    deviceKeys.includes(command.deviceId) &&
    isExitAgentAppCommandActive(command)
  ) ?? null;
}

export function exitAgentAppTransportStatus(command: ExitAgentAppCommandView) {
  return command.status || "UNKNOWN";
}

export type ExitAgentAppBusinessResult = "DONE" | "PARTIAL" | "FAILED";

export function exitAgentAppBusinessResult(command: ExitAgentAppCommandView): ExitAgentAppBusinessResult | null {
  const result = command.resultJson?.result;
  return result === "DONE" || result === "PARTIAL" || result === "FAILED" ? result : null;
}

export type ExitAgentAppDisplayStatus = "PENDING" | "CLAIMED" | "RUNNING" | "DONE" | "PARTIAL" | "FAILED" | "TIMED_OUT" | "IGNORED";

export function exitAgentAppDisplayStatus(command: ExitAgentAppCommandView): ExitAgentAppDisplayStatus | null {
  const businessResult = exitAgentAppBusinessResult(command);
  if (businessResult) return businessResult;
  if (command.status === "FETCHED") return "RUNNING";
  if (["PENDING", "CLAIMED", "RUNNING", "DONE", "FAILED", "TIMED_OUT", "IGNORED"].includes(command.status)) {
    return command.status as ExitAgentAppDisplayStatus;
  }
  return null;
}

const exitStageNames = ["STOP_AGENT", "REMOVE_APP_TASK", "LOCK_SCREEN"] as const;

export function exitAgentAppStages(command: ExitAgentAppCommandView) {
  const stages = command.resultJson?.stages;
  return exitStageNames.map((name) => {
    const stage = (stages ?? []).find((candidate) => candidate.name === name);
    return {
      name,
      status: stage?.status || "NOT_REPORTED",
      reason: stage?.reason || ""
    };
  });
}

function isBaseOnline(device: RemoteWakeDeviceState) {
  return device.baseReachable === true &&
    device.baseStatus === "online" &&
    device.baseConnectivityStatus === "ONLINE";
}

function hasKnownDeviceSnapshot(device: RemoteWakeDeviceState) {
  return typeof device.agentReachable === "boolean" &&
    (["locked", "unlocked"] as string[]).includes(device.screenState ?? "") &&
    (["foreground", "background", "not_running"] as string[]).includes(device.appUiState ?? "");
}

function screenText(device: RemoteWakeDeviceState) {
  return device.screenState === "locked" ? "当前手机已锁屏" : "当前手机已解锁";
}

function hasAppUiTask(device: RemoteWakeDeviceState) {
  return device.appUiState === "foreground" || device.appUiState === "background";
}

export function resolveRemoteWakeAction(device: RemoteWakeDeviceState): RemoteWakeActionPlan {
  if (!isBaseOnline(device)) {
    return {
      kind: "unavailable",
      title: "设备离线等待接入",
      content: "目前手机已关机，或者手机当前无网络或存在其他连接问题，无法打开燎原星火。",
      commandType: null
    };
  }

  if (!(["locked", "unlocked"] as string[]).includes(device.screenState ?? "") ||
      !(["foreground", "background", "not_running"] as string[]).includes(device.appUiState ?? "")) {
    return {
      kind: "unavailable",
      title: "正在获取设备状态",
      content: "设备已在线，但屏幕或 App 界面状态尚未确认，请稍后刷新后重试。",
      commandType: null
    };
  }

  const locked = device.screenState === "locked";
  if (!device.agentReachable) {
    return {
      kind: "confirm",
      title: "确认开启 Agent",
      content: locked
        ? "当前手机已锁屏，Agent 未开启，是否解锁手机并开启 Agent？"
        : "当前手机已解锁，Agent 未开启，是否开启 Agent？",
      commandType: "START_AGENT"
    };
  }

  if (locked) {
    return {
      kind: "confirm",
      title: "确认打开燎原星火",
      content: "当前手机已锁屏，Agent 已开启，是否解锁手机并打开燎原星火？",
      commandType: "START_AGENT"
    };
  }

  if (device.appUiState !== "foreground") {
    return {
      kind: "confirm",
      title: "确认打开燎原星火",
      content: device.appUiState === "background"
        ? "Agent 已开启，燎原星火当前在后台，是否打开？"
        : "Agent 已开启，燎原星火界面当前未运行，是否打开？",
      commandType: "START_AGENT"
    };
  }

  return {
    kind: "ready",
    title: "设备状态正常",
    content: "手机已解锁，燎原星火位于前台，Agent 已开启，无需重复操作。",
    commandType: null
  };
}

export function resolveExitAgentAppAction(device: RemoteWakeDeviceState): ExitAgentAppActionPlan {
  if (!isBaseOnline(device)) {
    return {
      kind: "info",
      title: "设备离线等待接入",
      content: "目前手机已关机，或者手机当前无网络或存在其他连接问题，无法退出燎原星火。",
      commandType: null,
      defaultLockScreen: false
    };
  }

  if (!hasKnownDeviceSnapshot(device)) {
    return {
      kind: "info",
      title: "正在获取设备状态",
      content: "设备已在线，但 Agent、屏幕或 App 界面状态尚未确认，请稍后刷新后重试。",
      commandType: null,
      defaultLockScreen: false
    };
  }

  const agentRunning = device.agentReachable === true;
  const appTaskRunning = hasAppUiTask(device);

  if (!agentRunning && !appTaskRunning) {
    return {
      kind: "info",
      title: "无需退出",
      content: "当前 Agent 已关闭，无后台程序。",
      commandType: null,
      defaultLockScreen: false
    };
  }

  if (!agentRunning && appTaskRunning) {
    return {
      kind: "confirm",
      title: "确认清除后台",
      content: `${screenText(device)}，Agent 已关闭，但留有燎原星火后台，是否清除后台？`,
      commandType: "EXIT_AGENT_APP",
      defaultLockScreen: false
    };
  }

  if (agentRunning && !appTaskRunning) {
    return {
      kind: "confirm",
      title: "确认关闭 Agent",
      content: `${screenText(device)}，Agent 已启动，App 无后台程序，是否关闭 Agent？`,
      commandType: "EXIT_AGENT_APP",
      defaultLockScreen: false
    };
  }

  return {
    kind: "confirm",
    title: "确认退出燎原星火",
    content: `${screenText(device)}，Agent 已启动，且留有燎原星火后台，是否关闭 Agent 并清除后台？`,
    commandType: "EXIT_AGENT_APP",
    defaultLockScreen: false
  };
}

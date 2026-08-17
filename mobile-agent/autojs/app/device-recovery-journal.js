var RECOVERY_STAGES = [
  "WAITING_DEVICE",
  "SYSTEM_BOOTED",
  "NETWORK_CONNECTED",
  "AGENT_LAUNCHED",
  "DEVICE_REGISTERED",
  "HEARTBEAT_RESTORED",
  "COMMAND_CHANNEL_READY"
];

var STAGE_ORDER = {};
for (var stageIndex = 0; stageIndex < RECOVERY_STAGES.length; stageIndex++) {
  STAGE_ORDER[RECOVERY_STAGES[stageIndex]] = stageIndex;
}

function defaultStorage() {
  if (typeof storages === "undefined" || !storages.create) {
    throw new Error("DEVICE_RECOVERY_STORAGE_UNAVAILABLE");
  }
  return storages.create("AgriVideoCollectorDeviceRecovery");
}

function systemBootId() {
  try {
    if (typeof android !== "undefined" && android.provider && android.provider.Settings) {
      var resolver = typeof context !== "undefined" && context.getContentResolver
        ? context.getContentResolver()
        : null;
      if (resolver && android.provider.Settings.Global) {
        var count = android.provider.Settings.Global.getInt(
          resolver,
          android.provider.Settings.Global.BOOT_COUNT,
          -1
        );
        if (count >= 0) {
          return "android-boot-" + count;
        }
      }
    }
  } catch (error) {
  }
  try {
    var elapsed = Number(android.os.SystemClock.elapsedRealtime());
    if (elapsed >= 0) {
      return "boot-epoch-" + Math.floor((Date.now() - elapsed) / 60000);
    }
  } catch (error2) {
  }
  return "runtime-" + Date.now();
}

function parseState(raw) {
  if (!raw) {
    return { events: [], stages: {} };
  }
  try {
    var parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      events: parsed && parsed.events && parsed.events.length ? parsed.events : [],
      stages: parsed && parsed.stages && typeof parsed.stages === "object" ? parsed.stages : {},
      activeManualWake: parsed && parsed.activeManualWake ? parsed.activeManualWake : undefined
    };
  } catch (error) {
    return { events: [], stages: {} };
  }
}

function createDeviceRecoveryJournal(options) {
  options = options || {};
  var storage = options.storage || defaultStorage();
  var bootId = String(options.bootId || systemBootId());
  var now = options.now || function () { return new Date().toISOString(); };
  var storageKey = options.storageKey || "journal.v1";

  function readState() {
    return parseState(storage.get(storageKey, ""));
  }

  function writeState(state) {
    storage.put(storageKey, JSON.stringify(state));
  }

  function currentStage() {
    var state = readState();
    return state.stages[bootId] || "WAITING_DEVICE";
  }

  function activeScope(state) {
    return state.activeManualWake && state.activeManualWake.commandId
      ? state.activeManualWake
      : { bootId: bootId, source: "AUTO_BOOT" };
  }

  function startManualWake(command) {
    if (!command || !String(command.commandId || "").trim()) {
      throw new Error("DEVICE_RECOVERY_COMMAND_ID_REQUIRED");
    }
    var state = readState();
    state.activeManualWake = {
      commandId: String(command.commandId),
      channel: command.channel || "AGENT_POLL",
      source: "MANUAL_WAKE"
    };
    writeState(state);
    return state.activeManualWake;
  }

  function finishManualWake(commandId) {
    var state = readState();
    if (!state.activeManualWake || state.activeManualWake.commandId !== commandId) return false;
    delete state.activeManualWake;
    writeState(state);
    return true;
  }

  function recordStage(stage, details, occurredAt) {
    stage = String(stage || "");
    if (STAGE_ORDER[stage] === undefined || stage === "WAITING_DEVICE") {
      throw new Error("DEVICE_RECOVERY_STAGE_INVALID");
    }
    var state = readState();
    var scope = activeScope(state);
    var scopeId = scope.commandId || scope.bootId;
    var eventKey = scopeId + ":" + stage;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].eventKey === eventKey) {
        return { created: false, reason: "duplicate", event: state.events[i] };
      }
    }
    var current = state.stages[scopeId] || "WAITING_DEVICE";
    var event = {
      eventKey: eventKey,
      bootId: scope.source === "AUTO_BOOT" ? scope.bootId : undefined,
      commandId: scope.commandId,
      channel: scope.channel,
      source: scope.source,
      stage: stage,
      occurredAt: occurredAt || now(),
      details: details || {}
    };
    state.events.push(event);
    if (STAGE_ORDER[stage] > STAGE_ORDER[current]) {
      state.stages[scopeId] = stage;
    }
    writeState(state);
    return { created: true, event: event };
  }

  function listEvents() {
    return readState().events.slice().sort(function (left, right) {
      if (left.occurredAt === right.occurredAt) {
        return STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage];
      }
      return left.occurredAt < right.occurredAt ? -1 : 1;
    });
  }

  function listPending() {
    return listEvents().filter(function (event) { return !event.reportedAt; });
  }

  function markReported(eventKey, reportedAt) {
    var state = readState();
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].eventKey === eventKey) {
        if (!state.events[i].reportedAt) {
          state.events[i].reportedAt = reportedAt || now();
          writeState(state);
        }
        return true;
      }
    }
    return false;
  }

  return {
    bootId: bootId,
    currentStage: currentStage,
    startManualWake: startManualWake,
    finishManualWake: finishManualWake,
    recordStage: recordStage,
    listEvents: listEvents,
    listPending: listPending,
    markReported: markReported
  };
}

module.exports = {
  RECOVERY_STAGES: RECOVERY_STAGES,
  createDeviceRecoveryJournal: createDeviceRecoveryJournal,
  systemBootId: systemBootId
};

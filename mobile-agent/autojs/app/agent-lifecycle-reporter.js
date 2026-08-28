"use strict";

function createAgentLifecycleReporter(options) {
  options = options || {};
  var config = options.config || {};
  var uploader = options.uploader;
  var storage = options.storage || null;
  var now = options.now || function () { return Date.now(); };
  var idFactory = options.idFactory || function () {
    try {
      if (typeof java !== "undefined" && java.util && java.util.UUID) {
        return String(java.util.UUID.randomUUID().toString());
      }
    } catch (error) {}
    return "agent-" + now() + "-" + Math.floor(Math.random() * 1000000);
  };
  var storageKey = "agentSessionId";
  var lastState = "";
  var lastPayload = null;

  function read(key, fallback) {
    try {
      if (storage && typeof storage.get === "function") return storage.get(key, fallback);
    } catch (error) {}
    return fallback;
  }

  function write(key, value) {
    try {
      if (storage && typeof storage.put === "function") storage.put(key, value);
    } catch (error) {}
  }

  function send(payload) {
    lastState = payload.agentLifecycleState;
    lastPayload = payload;
    write("agentLifecycleState", payload.agentLifecycleState);
    write("pollingEnabled", payload.pollingEnabled);
    write("agentStateReason", payload.agentStateReason || "");
    write("agentStateChangedAt", payload.agentStateChangedAt);
    write(storageKey, payload.agentSessionId || "");
    try {
      if (!uploader || typeof uploader.uploadHeartbeat !== "function") {
        return { success: false, message: "uploader_missing", payload: payload };
      }
      var result = uploader.uploadHeartbeat(payload) || {};
      return { status: payload.status, pollingEnabled: payload.pollingEnabled,
        agentLifecycleState: payload.agentLifecycleState, agentSessionId: payload.agentSessionId,
        agentStateReason: payload.agentStateReason, agentStateChangedAt: payload.agentStateChangedAt,
        success: result.success !== false, upload: result };
    } catch (error) {
      return { status: payload.status, pollingEnabled: payload.pollingEnabled,
        agentLifecycleState: payload.agentLifecycleState, agentSessionId: payload.agentSessionId,
        agentStateReason: payload.agentStateReason, agentStateChangedAt: payload.agentStateChangedAt,
        success: false, message: String(error) };
    }
  }

  function basePayload(state, reason, sessionId) {
    var changedAt = new Date(now()).toISOString();
    return {
      status: state === "STOPPED" ? "stopped" : "idle",
      sceneType: "",
      lastMessage: reason || (state === "STOPPED" ? "内部 Agent 已停止" : "内部 Agent 已启动"),
      agentLifecycleState: state,
      pollingEnabled: state === "RUNNING",
      agentStateReason: reason || (state === "STOPPED" ? "LOCAL_STOP_BUTTON" : "AGENT_STARTED"),
      agentStateChangedAt: changedAt,
      agentSessionId: sessionId || ""
    };
  }

  function reportStopped(reason, sessionId) {
    var activeSession = sessionId || String(read(storageKey, "") || "");
    return send(basePayload("STOPPED", reason || "LOCAL_STOP_BUTTON", activeSession));
  }

  function reportRunning(sessionId) {
    var nextSession = sessionId || String(idFactory() || "");
    if (!nextSession) nextSession = "agent-" + now();
    return send(basePayload("RUNNING", "AGENT_STARTED", nextSession));
  }

  return {
    reportStopped: reportStopped,
    reportRunning: reportRunning,
    getLastState: function () { return lastState; },
    getLastPayload: function () { return lastPayload; }
  };
}

module.exports = {
  createAgentLifecycleReporter: createAgentLifecycleReporter
};

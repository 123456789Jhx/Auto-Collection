"use strict";

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== "object") return value;
  var output = {};
  Object.keys(value).forEach(function (key) { output[key] = clone(value[key]); });
  return output;
}

function createCommandAckOutbox(options) {
  options = options || {};
  var send = options.send;
  var limit = Math.max(1, Number(options.limit) || 20);
  var flushLimit = Math.max(1, Number(options.flushLimit) || 4);
  var criticalReserve = Math.max(1, Number(options.criticalReserve) || 2);
  var entries = {};
  var order = [];
  var laneCounts = { regular: 0, critical: 0 };

  function remove(key) {
    var item = entries[key];
    if (item) laneCounts[item.lane] -= 1;
    delete entries[key];
    var index = order.indexOf(key);
    if (index >= 0) order.splice(index, 1);
  }

  function failure(item, error) {
    try { if (typeof item.onFailure === "function") item.onFailure(error); } catch (ignored) {}
  }

  function evictOldestRegular() {
    for (var index = 0; index < order.length; index += 1) {
      var item = entries[order[index]];
      if (!item || item.lane !== "regular" || !item.degradable) continue;
      remove(item.key);
      var reason = "ACK_OUTBOX_LOW_PRIORITY_EVICTED";
      try { if (typeof item.onDropped === "function") item.onDropped(reason); } catch (ignored) {}
      try { if (typeof options.onDrop === "function") options.onDrop(item, reason); } catch (ignored) {}
      return true;
    }
    return false;
  }

  function deliver(item) {
    var response;
    try {
      response = send(item.commandId, item.status, item.result);
    } catch (error) {
      failure(item, error);
      return false;
    }
    if (response && response.success === false) {
      failure(item, new Error(String(response.message || "ACK_REJECTED")));
      return false;
    }
    remove(item.key);
    try { if (typeof item.onDelivered === "function") item.onDelivered(); } catch (ignored) {}
    return true;
  }

  function submit(input) {
    var key = String(input && input.key || "");
    if (!key) throw new Error("ACK_OUTBOX_KEY_REQUIRED");
    if (entries[key]) return deliver(entries[key]);
    var lane = input.critical ? "critical" : "regular";
    var laneLimit = lane === "critical" ? criticalReserve : limit;
    var item = {
      key: key,
      commandId: String(input.commandId || ""),
      status: String(input.status || ""),
      result: clone(input.result || {}),
      onDelivered: input.onDelivered,
      onFailure: input.onFailure,
      onDropped: input.onDropped,
      degradable: input.degradable === true,
      commandType: String(input.commandType || ""),
      lane: lane
    };
    if (deliver(item)) return true;
    if (laneCounts[lane] >= laneLimit) {
      if (lane !== "regular" || !item.degradable || !evictOldestRegular()) {
        failure(item, new Error("ACK_OUTBOX_FULL"));
        return false;
      }
    }
    entries[key] = item;
    order.push(key);
    laneCounts[lane] += 1;
    return false;
  }

  function flush() {
    var attempts = Math.min(flushLimit, order.length);
    for (var index = 0; index < attempts; index += 1) {
      var key = order.shift();
      var item = entries[key];
      if (!item) continue;
      if (!deliver(item) && entries[key]) order.push(key);
    }
    return order.length;
  }

  return {
    submit: submit,
    flush: flush,
    isFull: function () { return laneCounts.regular >= limit; },
    canAcceptRegular: function () { return laneCounts.regular < limit; },
    size: function () { return order.length; }
  };
}

module.exports = { createCommandAckOutbox: createCommandAckOutbox };

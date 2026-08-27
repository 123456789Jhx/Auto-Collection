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
  var entries = {};
  var order = [];

  function remove(key) {
    delete entries[key];
    var index = order.indexOf(key);
    if (index >= 0) order.splice(index, 1);
  }

  function failure(item, error) {
    try { if (typeof item.onFailure === "function") item.onFailure(error); } catch (ignored) {}
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
    var item = {
      key: key,
      commandId: String(input.commandId || ""),
      status: String(input.status || ""),
      result: clone(input.result || {}),
      onDelivered: input.onDelivered,
      onFailure: input.onFailure
    };
    if (deliver(item)) return true;
    if (order.length >= limit) {
      failure(item, new Error("ACK_OUTBOX_FULL"));
      return false;
    }
    entries[key] = item;
    order.push(key);
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
    isFull: function () { return order.length >= limit; },
    size: function () { return order.length; }
  };
}

module.exports = { createCommandAckOutbox: createCommandAckOutbox };

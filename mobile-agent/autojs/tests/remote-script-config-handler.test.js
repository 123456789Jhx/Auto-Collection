var assert = require("assert");
var fs = require("fs");
var path = require("path");
var createRemoteScriptConfigHandler = require("../app/remote-script-config-handler.js").createRemoteScriptConfigHandler;

function createStorage(initial) {
  var values = Object.assign({}, initial || {});
  return {
    get: function (key, fallback) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    },
    put: function (key, value) {
      values[key] = value;
    },
    remove: function (key) {
      delete values[key];
    },
    values: values
  };
}

function createContext(options) {
  var acks = [];
  var applied = [];
  var storage = options.storage || createStorage();
  return {
    config: { device: { deviceId: "test-device", deviceToken: "token" }, upload: { baseUrl: "http://localhost/api/v1" } },
    logger: { info: function () {}, warn: function () {} },
    uploader: {
      ackCommand: function (id, status, result) {
        acks.push({ id: id, status: status, result: result });
        return { success: true };
      }
    },
    remoteScriptClient: options.client,
    remoteScriptStorage: storage,
    applyRemoteScriptConfig: function (scriptKey, config) {
      applied.push({ scriptKey: scriptKey, config: config });
    },
    acks: acks,
    applied: applied,
    storage: storage
  };
}

function testAppliesAndAcknowledgesPulledConfig() {
  var context = createContext({
    client: {
      fetchConfig: function () {
        return {
          scriptKey: "generic_form",
          configPayload: { keywords: ["玉米"] },
          revision: 3,
          configHash: "hash-3"
        };
      }
    }
  });
  var handler = createRemoteScriptConfigHandler(context);

  handler.handle({ id: "command-1", commandType: "SCRIPT_CONFIG_UPDATED", payload: {
    script_key: "generic_form",
    revision: 3,
    config_hash: "hash-3"
  } });

  assert.strictEqual(context.applied.length, 1);
  assert.strictEqual(context.applied[0].config.revision, 3);
  assert.strictEqual(context.storage.values["remote_script_config:generic_form"].configHash, "hash-3");
  assert.deepStrictEqual(context.acks[0], {
    id: "command-1",
    status: "DONE",
    result: { applied: true, commandType: "SCRIPT_CONFIG_UPDATED", scriptKey: "generic_form", appliedRevision: 3, configHash: "hash-3" }
  });
}

function testClearsConfigWhenBindingIsRemoved() {
  var storage = createStorage({
    "remote_script_config:generic_form": { revision: 2, configHash: "old" }
  });
  var context = createContext({
    storage: storage,
    client: { fetchConfig: function () { return null; } }
  });
  var handler = createRemoteScriptConfigHandler(context);

  handler.handle({ id: "command-2", commandType: "SCRIPT_CONFIG_UPDATED", payload: {
    script_key: "generic_form",
    revision: 3,
    config_hash: "hash-3"
  } });

  assert.strictEqual(storage.get("remote_script_config:generic_form", null), null);
  assert.strictEqual(context.applied[0].config, null);
  assert.strictEqual(context.acks[0].status, "DONE");
  assert.strictEqual(context.acks[0].result.appliedRevision, 0);
  assert.strictEqual(context.acks[0].result.removed, true);
}

function testFailedPullAcknowledgesFailure() {
  var context = createContext({
    client: { fetchConfig: function () { throw new Error("offline"); } }
  });
  var handler = createRemoteScriptConfigHandler(context);

  handler.handle({ id: "command-3", commandType: "SCRIPT_CONFIG_UPDATED", payload: { script_key: "generic_form" } });

  assert.strictEqual(context.acks[0].status, "FAILED");
  assert.strictEqual(context.acks[0].result.applied, false);
  assert(context.acks[0].result.message.indexOf("offline") >= 0);
}

function testControlLoopWiresHandler() {
  var source = fs.readFileSync(path.join(__dirname, "../app/control-loop.js"), "utf8");
  assert(source.indexOf("createRemoteScriptConfigHandler") >= 0, "control loop should initialize remote script handler");
  assert(source.indexOf('commandType === "SCRIPT_CONFIG_UPDATED"') >= 0, "control loop should dispatch script config commands");
}

testAppliesAndAcknowledgesPulledConfig();
testClearsConfigWhenBindingIsRemoved();
testFailedPullAcknowledgesFailure();
testControlLoopWiresHandler();

console.log("remote script config handler tests passed");

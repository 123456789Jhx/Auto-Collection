var assert = require("assert");
var createOcr = require("../core/ocr.js").createOcr;

function withOcrGlobals(values, callback) {
  var names = ["ocr", "paddle", "$ocr", "sleep"];
  var previous = {};

  names.forEach(function (name) {
    previous[name] = {
      exists: Object.prototype.hasOwnProperty.call(global, name),
      value: global[name]
    };
    delete global[name];
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      global[name] = values[name];
    }
  });

  try {
    callback();
  } finally {
    names.forEach(function (name) {
      if (previous[name].exists) {
        global[name] = previous[name].value;
      } else {
        delete global[name];
      }
    });
  }
}

function createHarness(retryCount) {
  var logs = [];
  return {
    logs: logs,
    engine: createOcr({
      runtime: {
        ocrRetryCount: retryCount || 3
      }
    }, {
      info: function (message, payload) {
        logs.push({ level: "INFO", message: message, payload: payload });
      },
      warn: function (message, payload) {
        logs.push({ level: "WARN", message: message, payload: payload });
      }
    })
  };
}

function selectedEngine(logs) {
  var item = logs.filter(function (log) {
    return log.level === "INFO" && log.payload && log.payload.engine;
  })[0];
  return item && item.payload.engine;
}

function unavailableLogs(logs) {
  return logs.filter(function (log) {
    return log.level === "WARN" && /unavailable/i.test(log.message);
  });
}

function testPrefersAutoJs6MlKitRecognizeText() {
  var calls = [];
  var legacyCalls = 0;
  var paddleCalls = 0;
  var dollarOcrCalls = 0;

  withOcrGlobals({
    ocr: {
      recognizeText: function (image, options) {
        calls.push({ image: image, options: options });
        return ["line one", "line two"];
      },
      recognize: function () {
        legacyCalls += 1;
      }
    },
    paddle: {
      ocr: function () {
        paddleCalls += 1;
      }
    },
    $ocr: {
      recognize: function () {
        dollarOcrCalls += 1;
      }
    },
    sleep: function () {}
  }, function () {
    var harness = createHarness();
    var image = { id: "screen" };
    assert.strictEqual(harness.engine.recognize(image), "line one\nline two");
    assert.deepStrictEqual(calls, [{ image: image, options: { mode: "mlkit" } }]);
    assert.strictEqual(legacyCalls, 0);
    assert.strictEqual(paddleCalls, 0);
    assert.strictEqual(dollarOcrCalls, 0);
    assert.strictEqual(selectedEngine(harness.logs), "autojs6_mlkit");
  });
}

function testUsesLegacyOcrRecognizeAndNormalizesNestedResults() {
  var paddleCalls = 0;
  var dollarOcrCalls = 0;
  withOcrGlobals({
    ocr: {
      recognize: function () {
        return {
          results: ["plain", { text: "text value" }, { label: "label value" }, {}]
        };
      }
    },
    paddle: {
      ocr: function () {
        paddleCalls += 1;
      }
    },
    $ocr: {
      recognize: function () {
        dollarOcrCalls += 1;
      }
    },
    sleep: function () {}
  }, function () {
    var harness = createHarness();
    assert.strictEqual(harness.engine.recognize({}), "plain\ntext value\nlabel value");
    assert.strictEqual(selectedEngine(harness.logs), "legacy_ocr");
    assert.strictEqual(paddleCalls, 0);
    assert.strictEqual(dollarOcrCalls, 0);
  });
}

function testKeepsPaddleAndDollarOcrFallbacks() {
  withOcrGlobals({
    paddle: {
      ocr: function () {
        return { text: "paddle text" };
      }
    },
    $ocr: {
      recognize: function () {
        throw new Error("lower-priority engine must not run");
      }
    },
    sleep: function () {}
  }, function () {
    var paddleHarness = createHarness();
    assert.strictEqual(paddleHarness.engine.recognize({}), "paddle text");
    assert.strictEqual(selectedEngine(paddleHarness.logs), "paddle");
  });

  withOcrGlobals({
    $ocr: {
      recognize: function () {
        return [{ label: "dollar ocr text" }];
      }
    },
    sleep: function () {}
  }, function () {
    var dollarHarness = createHarness();
    assert.strictEqual(dollarHarness.engine.recognize({}), "dollar ocr text");
    assert.strictEqual(selectedEngine(dollarHarness.logs), "$ocr");
  });
}

function testRetriesSelectedEngineAndLogsEngineAndAttempt() {
  var attempts = 0;
  var sleeps = [];

  withOcrGlobals({
    ocr: {
      recognizeText: function () {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("temporary failure " + attempts);
        }
        return "recovered";
      }
    },
    sleep: function (delayMs) {
      sleeps.push(delayMs);
    }
  }, function () {
    var harness = createHarness(3);
    assert.strictEqual(harness.engine.recognize({}), "recovered");
    assert.strictEqual(attempts, 3);
    assert.deepStrictEqual(sleeps, [500, 500]);
    var failures = harness.logs.filter(function (log) {
      return log.level === "WARN" && log.payload && log.payload.attempt;
    });
    assert.deepStrictEqual(failures.map(function (log) {
      return { engine: log.payload.engine, attempt: log.payload.attempt };
    }), [
      { engine: "autojs6_mlkit", attempt: 1 },
      { engine: "autojs6_mlkit", attempt: 2 }
    ]);
    assert.strictEqual(unavailableLogs(harness.logs).length, 0);
  });
}

function testWarnsUnavailableOnlyWhenAllCapabilitiesAreMissing() {
  withOcrGlobals({
    sleep: function () {}
  }, function () {
    var harness = createHarness();
    assert.strictEqual(harness.engine.recognize({}), "");
    assert.strictEqual(unavailableLogs(harness.logs).length, 1);
    assert.strictEqual(selectedEngine(harness.logs), undefined);
  });

  withOcrGlobals({
    ocr: {
      recognizeText: function () {
        throw new Error("persistent failure");
      }
    },
    sleep: function () {}
  }, function () {
    var harness = createHarness(1);
    assert.strictEqual(harness.engine.recognize({}), "");
    assert.strictEqual(unavailableLogs(harness.logs).length, 0);
  });
}

testPrefersAutoJs6MlKitRecognizeText();
testUsesLegacyOcrRecognizeAndNormalizesNestedResults();
testKeepsPaddleAndDollarOcrFallbacks();
testRetriesSelectedEngineAndLogsEngineAndAttempt();
testWarnsUnavailableOnlyWhenAllCapabilitiesAreMissing();
console.log("ocr adapter tests passed");

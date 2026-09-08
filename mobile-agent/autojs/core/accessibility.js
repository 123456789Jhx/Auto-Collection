try {
  importClass(android.provider.Settings);
} catch (error) {
}

var KNOWN_AUTOJS_PACKAGES = [
  "org.autojs.autojs",
  "org.autojs.autojs6",
  "org.autojs.autoxjs",
  "com.stardust.autojs",
  "com.stardust.autojs.inrt",
  "com.agri.video.collector"
];

var appContext = null;

function setContext(value) {
  appContext = value || null;
}

function getContext() {
  if (appContext) {
    return appContext;
  }
  try {
    if (typeof context !== "undefined" && context) {
      return context;
    }
  } catch (error) {
  }
  return null;
}

function getCurrentPackageName() {
  try {
    var ctx = getContext();
    return ctx && ctx.getPackageName ? String(ctx.getPackageName()) : "";
  } catch (error) {
    return "";
  }
}

function readEnabledAccessibilityServices(ctx) {
  try {
    return Settings.Secure.getString(
      ctx.getContentResolver(),
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) || "";
  } catch (error) {
    return null;
  }
}

function getEnabledAccessibilityServices() {
  var ctx = getContext();
  if (!ctx) {
    return "";
  }
  var enabledServices = readEnabledAccessibilityServices(ctx);
  return enabledServices === null ? "" : enabledServices;
}

function serviceMatchesPackage(serviceName, packageName) {
  if (!serviceName || !packageName) {
    return false;
  }
  var service = String(serviceName).toLowerCase();
  var pkg = String(packageName).toLowerCase();
  return service === pkg || service.indexOf(pkg + "/") === 0;
}

function detectAccessibility(extraPackages) {
  if (typeof auto !== "undefined" && auto.service) {
    return {
      enabled: true,
      source: "auto.service",
      packageName: getCurrentPackageName(),
      enabledServices: ""
    };
  }

  var ctx = getContext();
  var currentPackage = getCurrentPackageName();
  if (!ctx) {
    return {
      enabled: false,
      source: "context_unavailable",
      packageName: currentPackage,
      enabledServices: ""
    };
  }

  var enabledServices = readEnabledAccessibilityServices(ctx);
  if (enabledServices === null) {
    return {
      enabled: false,
      source: "settings_unavailable",
      packageName: currentPackage,
      enabledServices: ""
    };
  }

  var services = String(enabledServices).split(":");
  var packages = [];
  if (currentPackage) {
    packages.push(currentPackage);
  }
  packages = packages.concat(extraPackages || [], KNOWN_AUTOJS_PACKAGES);

  for (var i = 0; i < services.length; i++) {
    for (var j = 0; j < packages.length; j++) {
      if (serviceMatchesPackage(services[i], packages[j])) {
        return {
          enabled: true,
          source: "settings",
          packageName: packages[j],
          enabledServices: enabledServices
        };
      }
    }
  }

  return {
    enabled: false,
    source: "none",
    packageName: currentPackage,
    enabledServices: enabledServices
  };
}

function isAccessibilityEnabled(extraPackages) {
  return !!detectAccessibility(extraPackages).enabled;
}

function resolveAutoService() {
  try {
    return typeof auto !== "undefined" && auto.service ? auto.service : null;
  } catch (error) {
    return null;
  }
}

function resolveGestureClasses(options) {
  var Path = options.Path || null;
  var GestureDescription = options.GestureDescription || null;
  if (Path && GestureDescription) return { Path: Path, GestureDescription: GestureDescription };
  try {
    Path = Path || android.graphics.Path;
    GestureDescription = GestureDescription || android.accessibilityservice.GestureDescription;
  } catch (error) {
    return { Path: Path, GestureDescription: GestureDescription };
  }
  return { Path: Path, GestureDescription: GestureDescription };
}

function normalizePoint(value) {
  if (Array.isArray(value)) {
    return { x: Number(value[0]), y: Number(value[1]) };
  }
  value = value || {};
  return { x: Number(value.x), y: Number(value.y) };
}

function validPoint(point) {
  return isFinite(point.x) && isFinite(point.y);
}

function createGestureDriver(options) {
  options = options || {};
  var service = options.service || resolveAutoService();
  var classes = resolveGestureClasses(options);

  function unavailable(reason) {
    return { success: false, reason: reason };
  }

  function dispatch(points, durationMs) {
    if (!service || typeof service.dispatchGesture !== "function") {
      return unavailable("ACCESSIBILITY_GESTURE_UNAVAILABLE");
    }
    if (!classes.Path || !classes.GestureDescription) {
      return unavailable("ACCESSIBILITY_GESTURE_CLASSES_UNAVAILABLE");
    }
    var normalized = (points || []).map(normalizePoint);
    if (!normalized.length || normalized.some(function (point) { return !validPoint(point); })) {
      return unavailable("ACCESSIBILITY_GESTURE_POINTS_INVALID");
    }
    var path = new classes.Path();
    path.moveTo(normalized[0].x, normalized[0].y);
    for (var index = 1; index < normalized.length; index += 1) {
      path.lineTo(normalized[index].x, normalized[index].y);
    }
    var GestureDescription = classes.GestureDescription;
    var stroke = new GestureDescription.StrokeDescription(path, 0, Math.max(1, Number(durationMs) || 150));
    var gesture = new GestureDescription.Builder().addStroke(stroke).build();
    try {
      var accepted = service.dispatchGesture(gesture, null, null);
      return accepted === false
        ? unavailable("ACCESSIBILITY_GESTURE_REJECTED")
        : { success: true };
    } catch (error) {
      return { success: false, reason: "ACCESSIBILITY_GESTURE_FAILED", message: String(error) };
    }
  }

  function swipeAndHold(input, inspect) {
    input = input || {};
    var now = options.now || Date.now;
    var pause = options.sleep || function (ms) { sleep(ms); };
    var state, failure, move, releaseGesture, handler, callback, holdCallback;
    var holdUntil = 0, accepted = false;
    function stopped() { return !!(input.shouldStop && input.shouldStop()); }
    function build(stroke) { return new classes.GestureDescription.Builder().addStroke(stroke).build(); }
    function waitFor(test, timeout) {
      var until = now() + timeout;
      while (!test() && now() < until) pause(Math.min(20, until - now()));
      if (!test()) throw new Error("gesture completion timeout");
    }
    function release() {
      try {
        if (service.dispatchGesture(releaseGesture, holdCallback, handler) === false) state.set(-1);
      } catch (error) { state.set(-1); }
    }
    try {
      if (stopped()) return unavailable("STOP_REQUESTED");
      if (!service || !classes.Path || !classes.GestureDescription) return unavailable("ACCESSIBILITY_GESTURE_UNAVAILABLE");
      var points = (input.points || []).map(normalizePoint);
      if (points.length < 2 || points.some(function (point) { return !validPoint(point); })) {
        return unavailable("ACCESSIBILITY_GESTURE_POINTS_INVALID");
      }
      var AtomicInteger = options.AtomicInteger || java.util.concurrent.atomic.AtomicInteger;
      state = new AtomicInteger(0);
      callback = options.createGestureCallback || function (methods) {
        return new JavaAdapter(android.accessibilityservice.AccessibilityService.GestureResultCallback, methods);
      };
      handler = options.handler || new android.os.Handler(android.os.Looper.getMainLooper());
      var path = new classes.Path(), endpoint = new classes.Path();
      path.moveTo(points[0].x, points[0].y);
      for (var i = 1; i < points.length; i += 1) path.lineTo(points[i].x, points[i].y);
      endpoint.moveTo(points[points.length - 1].x, points[points.length - 1].y);
      var duration = Math.max(1, Number(input.durationMs) || 520);
      var holdMs = Math.max(1, Math.min(2000, Number(input.holdMs) || 2000));
      move = new classes.GestureDescription.StrokeDescription(path, 0, duration, true);
      // The continuation ends natively after holdMs, even if OCR blocks the worker.
      var holdGesture = build(move.continueStroke(endpoint, 0, holdMs, false));
      releaseGesture = build(move.continueStroke(endpoint, 0, 1, false));
      holdCallback = callback({
        onCompleted: function () { state.set(failure ? -1 : 2); },
        onCancelled: function () { failure = unavailable("ACCESSIBILITY_GESTURE_CANCELLED"); state.set(-1); }
      });
      var moveCallback = callback({
        onCompleted: function () {
          if (failure) { release(); return; }
          try {
            holdUntil = now() + holdMs;
            state.set(1);
            if (service.dispatchGesture(holdGesture, holdCallback, handler) === false) {
              failure = unavailable("ACCESSIBILITY_HOLD_REJECTED"); release();
            }
          } catch (error) {
            failure = unavailable("ACCESSIBILITY_HOLD_FAILED"); release();
          }
        },
        onCancelled: function () { failure = unavailable("ACCESSIBILITY_GESTURE_CANCELLED"); state.set(-1); }
      });
      accepted = service.dispatchGesture(build(move), moveCallback, handler) !== false;
      if (!accepted) return unavailable("ACCESSIBILITY_GESTURE_REJECTED");
      waitFor(function () { return state.get() !== 0; }, duration + 1500);
      var result;
      try {
        if (!failure && state.get() === 1 && !stopped()) {
          result = inspect(function () { return state.get() === 1 && now() < holdUntil; });
        }
      } finally {
        waitFor(function () { return state.get() === 2 || state.get() === -1; }, holdMs + 1500);
      }
      if (stopped()) return unavailable("STOP_REQUESTED");
      return failure || result || unavailable("ACCESSIBILITY_HOLD_NOT_OBSERVED");
    } catch (error) {
      failure = { success: false, reason: "ACCESSIBILITY_HOLD_FAILED", message: String(error) };
      // A missing movement callback must not leave a continuing stroke held down.
      if (accepted && state && state.get() === 0 && releaseGesture) release();
      return failure;
    }
  }

  return {
    swipeAndHold: swipeAndHold,
    tap: function (input) {
      input = input || {};
      return dispatch([{ x: input.x, y: input.y }], input.durationMs || 150);
    },
    swipe: function (input) {
      input = input || {};
      return dispatch(input.points, input.durationMs || 520);
    }
  };
}

module.exports = {
  setContext: setContext,
  detectAccessibility: detectAccessibility,
  isAccessibilityEnabled: isAccessibilityEnabled,
  getEnabledAccessibilityServices: getEnabledAccessibilityServices,
  createGestureDriver: createGestureDriver
};

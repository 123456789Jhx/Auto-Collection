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

  return {
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

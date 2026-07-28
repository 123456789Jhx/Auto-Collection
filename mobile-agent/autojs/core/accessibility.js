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

module.exports = {
  setContext: setContext,
  detectAccessibility: detectAccessibility,
  isAccessibilityEnabled: isAccessibilityEnabled,
  getEnabledAccessibilityServices: getEnabledAccessibilityServices
};

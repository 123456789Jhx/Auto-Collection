/**
 * 设备画像（device profile）
 *
 * 背景：小米8 与小米14 这类差异较大的机型，在截图授权弹窗能否交互、公共目录
 * 是否可写、打开抖音后要等多久这些行为上都不一样。历史上这些差异是通过直接
 * 修改共用代码来适配的，结果一次适配会同时影响所有机型。
 *
 * 这里把它们收敛成"按机型选择的参数集合"：default 供未识别机型使用，
 * 具体机型条目只影响命中的那台设备。
 *
 * 取值分两层，后者覆盖前者：
 *   1. 本文件内置的画像（兜底，随 APK 打包，离线可用）
 *   2. 服务端 device_task_configs.device_profile 下发（可远程调整，无需重装）
 *
 * 本模块不依赖 AutoJS 运行时全局变量，机型信息通过参数传入，便于单元测试。
 */

// 未识别机型使用的画像，等价于历史既有行为。
var DEFAULT_VALUES = {
  // 截图授权流程
  capture: {
    // 申请前先把自身 App 拉回前台。MIUI/HyperOS 会拦截「后台弹出界面」，
    // 后台发起的授权弹窗能显示但点不动。
    bringSelfToForeground: true,
    foregroundWaitMs: 800,
    // 在子线程发起 requestScreenCapture。主线程同步调用会冻结事件分发，
    // 导致系统弹窗上的按钮点了没反应。
    useWorkerThread: true,
    // 等待用户在系统弹窗上确认的最长时间。
    timeoutMs: 120000
  },
  // 打开抖音后的等待区间（毫秒）。
  openDouyinWaitMs: [5000, 7000],
  // 顺序探测可写的输出根目录；留空数组表示直接用脚本目录。
  outputRoots: [
    "/storage/emulated/0/燎原星火",
    "/sdcard/燎原星火",
    "/storage/emulated/0/Download/燎原星火",
    "/sdcard/Download/燎原星火",
    "/storage/emulated/0/AgriVideoCollector",
    "/sdcard/AgriVideoCollector"
  ],
  // 为无障碍节点查询预留的额外宽限，慢机型可调大。
  nodeQueryGraceMs: 0
};

// 机型画像。models 与 device.model 精确匹配（忽略大小写与首尾空格）。
var BUILT_IN_PROFILES = [
  {
    key: "xiaomi_mi8",
    label: "小米8",
    models: ["MI 8", "MI8", "M1803E1A", "M1803E1C", "M1803E1T"],
    values: {}
  },
  {
    key: "xiaomi_14",
    label: "小米14",
    models: ["23127PN0CC", "23127PN0CG", "24129PN74C", "24129PN74G"],
    values: {
      capture: {
        // HyperOS 的「后台弹出界面」拦截更严格，拉起后多等一会再弹授权。
        foregroundWaitMs: 1200
      },
      // 小米14 未授予「所有文件访问」时公共目录不可写，逐个探测只会白白失败。
      // 直接使用应用私有目录，行为确定。若后续授权成功，可由服务端下发覆盖。
      outputRoots: [],
      recentsExit: {
        baseWidth: 1200,
        baseHeight: 2670,
        startRect: { left: 900, top: 1820, right: 1050, bottom: 2270 },
        endRect: { left: 900, top: 550, right: 1050, bottom: 1000 },
        durationMs: [480, 600]
      }
    }
  }
];

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeModel(value) {
  return String(value === undefined || value === null ? "" : value).trim().toUpperCase();
}

function mergeValues(base, override) {
  var result = {};
  Object.keys(base || {}).forEach(function (key) {
    result[key] = base[key];
  });
  Object.keys(override || {}).forEach(function (key) {
    var next = override[key];
    if (next === undefined || next === null) return;
    var prev = result[key];
    if (isPlainObject(prev) && isPlainObject(next)) {
      result[key] = mergeValues(prev, next);
      return;
    }
    result[key] = next;
  });
  return result;
}

function findBuiltInProfile(model, builtIn) {
  var normalized = normalizeModel(model);
  if (!normalized) return null;
  var list = builtIn || BUILT_IN_PROFILES;
  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    var models = (entry.models || []).map(normalizeModel);
    if (models.indexOf(normalized) >= 0) return entry;
  }
  return null;
}

function resolveByKey(key, builtIn) {
  var normalized = String(key || "").trim();
  if (!normalized) return null;
  var list = builtIn || BUILT_IN_PROFILES;
  for (var i = 0; i < list.length; i++) {
    if (list[i].key === normalized) return list[i];
  }
  return null;
}

/**
 * 解析当前设备的画像。
 *
 * @param {object} options
 * @param {object} options.device          设备信息，如 { model, brand, sdkInt }
 * @param {object} options.config          本地 config，读取 config.deviceProfile
 * @param {object} options.serverOverride  服务端下发的画像覆盖
 * @param {array}  options.builtIn         自定义内置画像表（测试用）
 * @returns {{enabled:boolean,key:string,label:string,matchedBy:string,values:object,source:string}}
 */
function resolveDeviceProfile(options) {
  options = options || {};
  var device = options.device || {};
  var config = options.config || {};
  var settings = config.deviceProfile || {};
  var builtIn = options.builtIn || BUILT_IN_PROFILES;

  // 本地覆盖优先于内置，服务端覆盖优先级最高。
  var localOverride = isPlainObject(settings.overrides) ? settings.overrides : null;
  var serverOverride = isPlainObject(options.serverOverride) ? options.serverOverride : null;

  if (settings.enabled === false) {
    return {
      enabled: false,
      key: "disabled",
      label: "设备画像已停用",
      matchedBy: "disabled",
      source: "local",
      values: mergeValues(DEFAULT_VALUES, null)
    };
  }

  var matched = null;
  var matchedBy = "default";
  // 本地强制指定机型画像，便于真机调试时锁定行为。
  var forced = resolveByKey(settings.forceKey, builtIn);
  if (forced) {
    matched = forced;
    matchedBy = "forceKey";
  } else if (String(options.overrideKey || "").trim()) {
    matched = resolveByKey(options.overrideKey, builtIn);
    if (matched) matchedBy = "overrideKey";
  } else {
    matched = findBuiltInProfile(device.model, builtIn);
    if (matched) matchedBy = "model";
  }

  var values = mergeValues(DEFAULT_VALUES, matched ? matched.values : null);
  var source = "builtin";
  if (localOverride) {
    values = mergeValues(values, localOverride);
    source = "local_override";
  }
  if (serverOverride) {
    values = mergeValues(values, serverOverride);
    source = "server_override";
  }

  return {
    enabled: true,
    key: matched ? matched.key : "default",
    label: matched ? matched.label : "未识别的机型",
    matchedBy: matchedBy,
    source: source,
    values: values
  };
}

/**
 * 读取画像里的等待区间。
 * 非法值一律回退到 fallback，避免机型画像写错导致等待变成 0 或 NaN。
 */
function pickWaitRange(range, fallback) {
  var fallbackRange = Array.isArray(fallback) && fallback.length >= 2 ? fallback : [0, 0];
  if (!Array.isArray(range) || range.length < 2) return fallbackRange.slice();
  var min = Number(range[0]);
  var max = Number(range[1]);
  if (!isFinite(min) || !isFinite(max) || min < 0 || max < min) return fallbackRange.slice();
  return [min, max];
}

function pickOutputRoots(profile) {
  var roots = profile && profile.values && profile.values.outputRoots;
  if (!Array.isArray(roots)) return [];
  return roots.filter(function (item) {
    return typeof item === "string" && item.length > 0;
  });
}

module.exports = {
  DEFAULT_VALUES: DEFAULT_VALUES,
  BUILT_IN_PROFILES: BUILT_IN_PROFILES,
  resolveDeviceProfile: resolveDeviceProfile,
  pickWaitRange: pickWaitRange,
  pickOutputRoots: pickOutputRoots,
  mergeValues: mergeValues,
  normalizeModel: normalizeModel
};

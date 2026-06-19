$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceDir = Join-Path $repoRoot "mobile-agent\autojs"
$distDir = Join-Path $repoRoot "dist\autojs"
$bundlePath = Join-Path $distDir "main.js"
$legacyBundlePath = Join-Path $distDir "main.bundle.js"

$moduleOrder = @(
  "config.js",
  "core\accessibility.js",
  "core\logger.js",
  "core\permission.js",
  "core\storage.js",
  "core\uploader.js",
  "core\ocr.js",
  "core\screen-recognizer.js",
  "core\matcher.js",
  "utils\autojs-utils.js",
  "utils\xml-dumper.js",
  "core\floaty-control.js",
  "platforms\douyin.js",
  "domain\risk-detector.js",
  "domain\live-scorer.js",
  "domain\live-room-detector.js",
  "domain\live-room-relevance-detector.js",
  "domain\live-comment-reader.js",
  "domain\live-comment-classifier.js",
  "domain\live-comment-readonly-probe.js",
  "domain\comment-safety-filter.js",
  "domain\agri-comment-bot-planner.js",
  "domain\comment-cache.js",
  "domain\trigger-detector.js",
  "domain\comment-action-planner.js",
  "domain\p3-extension-actions.js",
  "domain\live-room-sampler.js",
  "domain\candidate-service.js",
  "app\heartbeat.js",
  "app\control-loop.js",
  "app\phase-runner.js",
  "app\collector-app.js"
)

$mainPath = Join-Path $sourceDir "main.module.js"

function Convert-ToModuleWrapper {
  param(
    [string]$ModuleId,
    [string]$Content
  )

  $escapedModuleId = $ModuleId.Replace("\", "/")
  return @"
__modules__["$escapedModuleId"] = function(module, exports) {
$Content
};

"@
}

$out = @"
var __modules__ = {};
var __cache__ = {};
function __require__(id) {
  id = id.replace(/\\/g, "/");
  if (__cache__[id]) {
    return __cache__[id].exports;
  }
  if (!__modules__[id]) {
    throw new Error("Bundled module not found: " + id);
  }
  var module = { exports: {} };
  __cache__[id] = module;
  __modules__[id](module, module.exports);
  return module.exports;
}

"@

foreach ($moduleId in $moduleOrder) {
  $path = Join-Path $sourceDir $moduleId
  $content = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "core/accessibility\.js"\)\)', '__require__("core/accessibility.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "core/screen-recognizer\.js"\)\)', '__require__("core/screen-recognizer.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "utils/xml-dumper\.js"\)\)', '__require__("utils/xml-dumper.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "utils/autojs-utils\.js"\)\)', '__require__("utils/autojs-utils.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "domain/risk-detector\.js"\)\)', '__require__("domain/risk-detector.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "domain/live-room-detector\.js"\)\)', '__require__("domain/live-room-detector.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "domain/live-comment-reader\.js"\)\)', '__require__("domain/live-comment-reader.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "domain/live-comment-classifier\.js"\)\)', '__require__("domain/live-comment-classifier.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "domain/live-comment-readonly-probe\.js"\)\)', '__require__("domain/live-comment-readonly-probe.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "domain/comment-cache\.js"\)\)', '__require__("domain/comment-cache.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "domain/trigger-detector\.js"\)\)', '__require__("domain/trigger-detector.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "domain/comment-action-planner\.js"\)\)', '__require__("domain/comment-action-planner.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "domain/p3-extension-actions\.js"\)\)', '__require__("domain/p3-extension-actions.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "domain/live-room-sampler\.js"\)\)', '__require__("domain/live-room-sampler.js")'
  $out += Convert-ToModuleWrapper -ModuleId $moduleId -Content $content
}

$main = Get-Content -LiteralPath $mainPath -Raw -Encoding UTF8
$main = $main -replace '"auto";', ''
$main = $main -replace '(?s)function localRequire\(path\).*?}', 'function localRequire(path) { return __require__(path); }'

$out += "`n// ---- main.js ----`n"
$out += @"
function engineSourceText(engine) {
  try {
    var source = engine && engine.getSource && engine.getSource();
    return source && source.toString ? source.toString() : "";
  } catch (error) {
    return "";
  }
}

function isCurrentEngine(engine, current) {
  if (!engine || !current) {
    return false;
  }
  try {
    if (engine === current) {
      return true;
    }
    if (engine.id !== undefined && current.id !== undefined && engine.id === current.id) {
      return true;
    }
  } catch (error) {
  }
  return false;
}

function isMainEngine(engine) {
  var sourceText = engineSourceText(engine);
  return sourceText.indexOf("/main.js") >= 0 || sourceText.indexOf("\\main.js") >= 0;
}

function hasOtherMainEngine() {
  try {
    var current = engines.myEngine();
    var all = engines.all();
    for (var i = 0; i < all.length; i++) {
      if (!isCurrentEngine(all[i], current) && isMainEngine(all[i])) {
        return true;
      }
    }
  } catch (error) {
  }
  return false;
}

if (hasOtherMainEngine()) {
  log("Agri collector main is already running, skip duplicate start.");
  toast("main.js已在运行");
  exit();
}

"@
$out += $main

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
Set-Content -LiteralPath $bundlePath -Value $out -Encoding UTF8
Set-Content -LiteralPath $legacyBundlePath -Value $out -Encoding UTF8
Write-Host "Bundle created:"
Write-Host $bundlePath
Write-Host $legacyBundlePath

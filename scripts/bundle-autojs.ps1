$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceDir = Join-Path $repoRoot "mobile-agent\autojs"
$bundlePath = Join-Path $sourceDir "main.bundle.js"

$moduleOrder = @(
  "config.js",
  "core\logger.js",
  "core\permission.js",
  "core\storage.js",
  "core\uploader.js",
  "core\ocr.js",
  "core\matcher.js",
  "utils\autojs-utils.js",
  "utils\xml-dumper.js",
  "core\floaty-control.js",
  "platforms\douyin.js"
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
"auto";

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
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "utils/xml-dumper\.js"\)\)', '__require__("utils/xml-dumper.js")'
  $content = $content -replace 'require\(files\.join\(config\.runtime\.scriptDir, "utils/autojs-utils\.js"\)\)', '__require__("utils/autojs-utils.js")'
  $out += Convert-ToModuleWrapper -ModuleId $moduleId -Content $content
}

$main = Get-Content -LiteralPath $mainPath -Raw -Encoding UTF8
$main = $main -replace '"auto";', ''
$main = $main -replace '(?s)function localRequire\(path\).*?}', 'function localRequire(path) { return __require__(path); }'

$out += "`n// ---- main.js ----`n"
$out += $main

Set-Content -LiteralPath $bundlePath -Value $out -Encoding UTF8
Write-Host "Bundle created:"
Write-Host $bundlePath

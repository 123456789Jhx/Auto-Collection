# AutoJs6 Offline OCR Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the packaged Agent use AutoJs6's bundled Chinese ML Kit OCR through the correct `ocr.recognizeText()` API.

**Architecture:** Keep OCR normalization and region capture in `core/ocr.js`, but replace capability detection with an ordered engine adapter. AutoJs6 ML Kit is preferred, legacy APIs remain compatible, and logs distinguish missing capability from invocation failure.

**Tech Stack:** AutoJs6 Rhino JavaScript, bundled ML Kit Chinese text recognition, Node test runner.

---

### Task 1: OCR Adapter Tests And Implementation

**Files:**
- Create: `mobile-agent/autojs/tests/ocr-adapter.test.js`
- Modify: `mobile-agent/autojs/core/ocr.js`

- [ ] **Step 1: Write failing adapter tests**

Load `core/ocr.js` in a VM or follow existing AutoJS test stubs. Cover preferred `ocr.recognizeText`, legacy `ocr.recognize`, Paddle fallback, normalization, invocation retry, and the all-capabilities-missing warning.

```js
global.ocr = {
  recognizeText(image, options) {
    calls.push({ image, options });
    return ["当归", "三七"];
  }
};
assert.equal(engine.recognize(fakeImage), "当归\n三七");
assert.equal(calls[0].options.mode, "mlkit");
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test mobile-agent/autojs/tests/ocr-adapter.test.js`

Expected: ML Kit preference test fails because production code only checks `ocr.recognize`.

- [ ] **Step 3: Implement ordered capability detection**

Use this order:

```js
if (typeof ocr !== "undefined" && typeof ocr.recognizeText === "function") {
  return { name: "autojs_mlkit", recognize: function (image) {
    return ocr.recognizeText(image, { mode: "mlkit" });
  } };
}
if (typeof ocr !== "undefined" && typeof ocr.recognize === "function") {
  return { name: "autojs_legacy", recognize: function (image) { return ocr.recognize(image); } };
}
```

Then retain the existing Paddle and `$ocr` candidates. Resolve the engine per attempt, normalize its return value, log the selected engine once, and log engine name plus attempt for failures. Emit the unavailable warning only when no candidate exists.

- [ ] **Step 4: Run focused verification**

Run:

```powershell
node --test mobile-agent/autojs/tests/ocr-adapter.test.js
node --check mobile-agent/autojs/core/ocr.js
node mobile-agent/autojs/tests/account-warmup-target-live.test.js
node mobile-agent/autojs/tests/account-warmup-interaction-runner.test.js
```

Expected: all commands exit 0.

### Task 2: APK Version And Packaging Readiness

**Files:**
- Modify: `mobile-agent/autojs/project.json`
- Verify: `scripts/package-autojs-apk.ps1`

- [ ] **Step 1: Bump APK identity**

Change `versionName` from `1.0.69` to `1.0.70` and `versionCode` from `105` to `106`. Preserve all other project metadata and optimization flags.

- [ ] **Step 2: Verify bundled OCR dependencies are retained**

Confirm AutoJs6 `app/build.gradle.kts` still includes `libs.text.recognition.chinese`, and the packaging script does not remove `mlkit-google-ocr-models` or ML Kit OCR native libraries. Do not execute the final APK build; the user owns that step.

- [ ] **Step 3: Run source-level release checks**

Run:

```powershell
git diff --check -- mobile-agent/autojs/core/ocr.js mobile-agent/autojs/tests/ocr-adapter.test.js mobile-agent/autojs/project.json
node --check mobile-agent/autojs/core/ocr.js
```

Expected: no whitespace errors and syntax check exits 0.

### Task 3: User-Owned APK Validation

After implementation is handed back, the user runs:

```powershell
cd "D:\new demo\Auto-Collection-main\Auto-Collection-main"
.\scripts\package-autojs-apk.ps1
```

Then the user installs the signed `1.0.70/106` APK over the existing package, confirms screenshot permission, and reruns a warmup task. Acceptance logs must name `autojs_mlkit`, show non-empty `ocrTextSample` for visible Chinese text, and enter the interaction chain when a configured related term is present.

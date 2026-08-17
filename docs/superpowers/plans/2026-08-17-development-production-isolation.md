# 开发与生产环境隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one source tree produce explicitly configured development and production APKs while keeping the management backend environments and data stores isolated.

**Architecture:** The PowerShell APK packager will resolve one environment profile and inject the same API base URL into the AutoJS config plus both native base-agent configuration files. The web and production compose defaults will use the actual `qk-*` domains, while secrets remain server-side environment values.

**Tech Stack:** PowerShell, Bun/Vite, Docker Compose, AutoJS JSON/JavaScript configuration.

---

### Task 1: Record the environment contract

**Files:**
- Create: `docs/superpowers/specs/2026-08-17-development-production-isolation-design.md`
- Create: `docs/superpowers/plans/2026-08-17-development-production-isolation.md`

- [x] **Step 1: Document the two build variants and acceptance criteria**

The design fixes production at `https://qk-api.dafengchan.top/api/v1` and requires an explicit, phone-reachable URL for development builds.

### Task 2: Add profile-aware APK configuration

**Files:**
- Modify: `scripts/package-autojs-apk.ps1`
- Test: `scripts/tests/package-autojs-apk-config.test.js`
- Modify: `account-data-platform/apps/api/src/config.ts`
- Test: `account-data-platform/apps/api/src/config.test.ts`

- [x] **Step 1: Add a failing test for profile resolution**

The test invokes the extracted profile helper with `production`, `development` without a URL, and `development` with a URL. It must assert that production resolves to the qk API URL, development without a URL throws, and development with a URL returns the normalized URL.

- [x] **Step 2: Run the focused test and verify it fails because the helper is absent**

Run: `node scripts/tests/package-autojs-apk-config.test.js`

Expected: FAIL because the packager helper is not exported/implemented yet.

- [x] **Step 3: Add environment parameters and staged configuration replacement**

Add `-Environment` (`development` or `production`) and `-ApiBaseUrl`. Resolve production to the fixed qk API URL; require a non-loopback explicit URL for development, while allowing the development secret to be empty. Replace the API base URL in staged `config.js`, `base-connectivity.json`, and `base-agent.json`, and use the selected profile in the output filename.

- [x] **Step 4: Run syntax and focused configuration checks**

Run: `node --check scripts/tests/package-autojs-apk-config.test.js` and `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-autojs-apk.ps1 -Environment development -SkipBuild -ApiBaseUrl http://192.168.1.10:3012/api/v1`.

Expected: the staged files contain the same selected URL and no Gradle build starts.

- [x] **Step 5: Keep development registration optional while retaining production enforcement**

`resolveConfig` ignores `MOBILE_REGISTRATION_SECRET` when `NODE_ENV=development`; production still rejects a missing or weak value. The packager embeds an empty value for a development APK unless the current process explicitly provides one.

### Task 3: Align production deployment defaults

**Files:**
- Modify: `account-data-platform/docker-compose.production.yml`
- Modify: `account-data-platform/deploy/docker/Dockerfile.web`
- Modify: `account-data-platform/.env.production.example`
- Modify: `account-data-platform/deploy/README.md`

- [x] **Step 1: Replace old production domain defaults**

Use `https://qk-api.dafengchan.top/api/v1` for API clients and `https://qk.dafengchan.top` as the Web origin. Keep secrets as placeholders and set `MOBILE_REQUEST_SIGNING_REQUIRED=true` in the example.

- [x] **Step 2: Remove the phone-facing loopback deployment example**

Document the public API URL for phones and clearly separate local-only `localhost` examples.

### Task 4: Validate without touching runtime data

**Files:**
- Modify: `docs/项目开发/项目记录.md`

- [x] **Step 1: Run targeted source checks**

Run `node --check` for the test helper, compose config interpolation with placeholder values, and `bun --filter @app/web build` if dependencies are available.

- [x] **Step 2: Record results and migration guardrails**

Record that production data, device tokens, and secrets must be backed up before switching the public tunnel; no APK rebuild is needed if the production API hostname stays unchanged.

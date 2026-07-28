# Publish Video Module Implementation Plan

> **For agentic workers:** Execute these steps in order with test-first verification. Keep the extraction mechanical and do not change API or mobile-agent code.

**Goal:** Add one Video Publishing menu and a four-tab page that composes the existing publishing, remote configuration, and device binding capabilities.

**Architecture:** Existing page logic becomes exported embeddable content while old pages remain thin route shells. A shared device table preserves the existing Devices page and supports a binding-only view. App navigation exposes `/publish-video` and keeps the hidden legacy routes directly addressable.

**Tech Stack:** React 19, TypeScript, Ant Design Tabs, TanStack Query, Bun test.

---

### Task 1: Lock the N2 contract

- [x] Update the publish task page test for hidden legacy navigation and shared content.
- [x] Add a source contract test for four tabs, fixed `publish_video` filtering, shared device list, menu order, and old route retention.
- [x] Run focused tests and confirm failure because N2 files and exports do not exist.

### Task 2: Extract reusable page content

- [x] Export `PublishTasksContent` from `PublishTasksPage.tsx` and leave `PublishTasksPage` as the existing `ops-page` shell.
- [x] Export `RemoteScriptsContent` from `RemoteScriptsPage.tsx` with optional `fixedScriptKey` and title props.
- [x] Use the fixed key in the query key/request, filter definitions for the modal, and hide the script type selector in fixed mode.
- [x] Keep all existing CRUD, binding, status, pagination, and topic completion behavior unchanged.

### Task 3: Extract the shared device table

- [x] Move the Devices page table into `DeviceList.tsx` with typed rows and a parameterized action renderer.
- [x] Preserve the Devices page columns and actions through one component call.
- [x] Add optional account binding status derived from the three `accountProfile` binding fields.
- [x] Add `DeviceBindingList.tsx` that queries all devices and exposes only `DeviceAccountBindingControl` actions.

### Task 4: Assemble and route the module

- [x] Create `PublishVideoModulePage.tsx` with Task Dashboard, Task Operations, Business Configuration, and Device Binding tabs.
- [x] Render the requested Development placeholder in Task Operations.
- [x] Add `/publish-video`, the new page key, render branch, and menu item immediately after Dashboard.
- [x] Hide Remote Scripts and Publish Tasks menu items under a `LEGACY_FREEZE` comment while retaining their path and render branches.
- [x] Keep TaskSchedulerPage and TasksPage imports and render branches unchanged.

### Task 5: Verify, document, and commit

- [x] Run focused tests, full `bun test`, typecheck, lint, build, line counts, and diff checks.
- [x] Start isolated API/Web processes and verify the five-item sidebar order, all four tabs, publish-only configuration, device binding modal, and both old URLs.
- [x] Record that biz-scripts publishing remains script-only and requires no UI migration.
- [x] Update the N2 ledger row and project record with real evidence.
- [x] Stage only N2 files and create the requested Chinese commit.

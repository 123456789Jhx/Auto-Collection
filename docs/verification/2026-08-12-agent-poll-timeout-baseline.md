# AGENT_POLL Timeout Baseline

## Observation

- Observed at: 2026-08-12 15:01 Asia/Shanghai
- Device code: `device_3c306f2e5ac76e97`
- App version: `1.0.79`
- Channel: `AGENT_POLL`
- Management-console state before the attempt: offline
- Last heartbeat shown: 2026-08-12 15:01:54
- Visible recovery stage: dispatched
- Final result: remote wake execution timed out

The phone had previously retained the Agent in the background and was locked. This baseline is intentionally not repaired as an isolated path. It will be replayed after automatic boot and manual wake share the same recovery session.

## Current Diagnostic Gap

The existing result proves only that the command was created and dispatched. It does not show whether:

1. the device fetched the command;
2. the screen wake was attempted;
3. keyguard dismissal succeeded;
4. the App launch was attempted;
5. the Agent registered;
6. heartbeat and command polling resumed.

## Required Evidence After Unification

The corresponding manual recovery session must preserve timestamps for `WAITING_DEVICE`, `SYSTEM_BOOTED` when applicable, `NETWORK_CONNECTED`, `AGENT_LAUNCHED`, `DEVICE_REGISTERED`, `HEARTBEAT_RESTORED`, and `COMMAND_CHANNEL_READY`. A timeout must name the first boundary that did not complete.

No registration secret, device token, administrator token or password is recorded in this baseline.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const javaRoot = path.join(root, "src", "main", "java", "com", "agri", "video", "collector", "base");
const read = (name) => fs.readFileSync(path.join(javaRoot, name), "utf8");

test("new outer base is fully sourced from the main project", () => {
  [
    "BaseConnectivityProtocol.kt",
    "BaseConnectivityClient.kt",
    "BaseConnectivityService.kt",
    "BaseConnectivityBootReceiver.kt",
    "BaseConnectivityStateStore.kt",
    "BaseConnectivityIdentity.kt"
  ].forEach((name) => assert.equal(fs.existsSync(path.join(javaRoot, name)), true, name));
});

test("heartbeat is isolated from Agent, commands, and remote wake", () => {
  const protocol = read("BaseConnectivityProtocol.kt");
  const client = read("BaseConnectivityClient.kt");
  const service = read("BaseConnectivityService.kt");
  const combined = protocol + client + service;

  assert.match(protocol, /base-connectivity\/heartbeats/);
  assert.match(protocol, /"deviceId"/);
  assert.match(protocol, /screenState/);
  assert.match(protocol, /appUiState/);
  assert.doesNotMatch(combined, /START_AGENT|STOP_AGENT|OPEN_AGENT_APP|pollCommands|agentState/);
});

test("service owns one bounded HTTP client shared by heartbeat and control", () => {
  const service = read("BaseConnectivityService.kt");
  const heartbeatClient = read("BaseConnectivityClient.kt");
  const controlRuntime = read("BaseControlRuntime.kt");
  const controlClient = read("BaseControlClient.kt");
  const combined = service + heartbeatClient + controlRuntime + controlClient;
  const builders = combined.match(/OkHttpClient\.Builder\(\)/g) || [];

  assert.equal(builders.length, 1, "the service must own the only OkHttpClient builder");
  assert.match(service, /private var sharedHttpClient:\s*OkHttpClient\?/);
  assert.match(
    service,
    /\.callTimeout\(config\.requestTimeoutMs,\s*TimeUnit\.MILLISECONDS\)/,
  );
  assert.match(service, /BaseConnectivityClient\(httpClient,\s*identity\)/);
  assert.match(service, /BaseControlRuntime\(this,\s*httpClient\)/);
  assert.match(heartbeatClient, /private val httpClient:\s*OkHttpClient/);
  assert.match(heartbeatClient, /httpClient\.newCall\(request\)/);
  assert.doesNotMatch(heartbeatClient, /OkHttpClient\.Builder\(\)/);
  assert.match(controlRuntime, /private val httpClient:\s*OkHttpClient/);
  assert.match(controlRuntime, /BaseControlClient\(httpClient,\s*identity\)/);
  assert.match(controlClient, /private val httpClient:\s*OkHttpClient/);
  assert.doesNotMatch(controlClient, /OkHttpClient\.Builder\(\)/);
  assert.match(service, /dispatcher\.cancelAll\(\)/);
  assert.match(service, /connectionPool\.evictAll\(\)/);
  assert.match(service, /dispatcher\.executorService\.shutdown\(\)/);
  assert.match(service, /serviceStopping\.set\(true\)/);
  assert.match(service, /if \(serviceStopping\.get\(\)\) return null/);
  assert.match(service, /scheduleWithFixedDelay\([\s\S]*runCatching \{ reportSafely\(\) \}/);
});

test("coalesces an immediate heartbeat when a network becomes validated", () => {
  const service = read("BaseConnectivityService.kt");
  const manifest = fs.readFileSync(path.join(root, "src", "main", "AndroidManifest.xml"), "utf8");

  assert.match(manifest, /android\.permission\.ACCESS_NETWORK_STATE/);
  assert.match(service, /ConnectivityManager\.NetworkCallback/);
  assert.match(service, /registerDefaultNetworkCallback\(networkCallback\)/);
  assert.match(service, /unregisterNetworkCallback\(networkCallback\)/);
  assert.match(
    service,
    /onCapabilitiesChanged[\s\S]*NET_CAPABILITY_VALIDATED[\s\S]*queueImmediateHeartbeat\(\)/,
  );
  assert.match(service, /override fun onLost\(network:\s*Network\)/);
  assert.match(service, /@Volatile\s+private var heartbeatExecutor/);
  assert.match(service, /AtomicBoolean\(false\)/);
  assert.match(service, /compareAndSet\(false,\s*true\)/);
  assert.match(
    service,
    /scheduler\.execute[\s\S]*reportSafely\(\)[\s\S]*finally[\s\S]*\.set\(false\)/,
  );
});

test("allows the exit flow to request an immediate outer heartbeat", () => {
  const service = read("BaseConnectivityService.kt");

  assert.match(service, /ACTION_REPORT_NOW/);
  assert.match(service, /fun requestImmediateHeartbeat\(context: Context\)/);
  assert.match(service, /intent\?\.action == ACTION_REPORT_NOW/);
  assert.match(service, /queueImmediateHeartbeat\(\)/);
});

test("foreground base starts at boot and reports every two seconds", () => {
  const manifest = fs.readFileSync(path.join(root, "src", "main", "AndroidManifest.xml"), "utf8");
  const service = read("BaseConnectivityService.kt");
  const receiver = read("BaseConnectivityBootReceiver.kt");

  assert.match(manifest, /RECEIVE_BOOT_COMPLETED/);
  assert.match(manifest, /FOREGROUND_SERVICE/);
  assert.match(manifest, /BaseConnectivityBootReceiver/);
  assert.match(manifest, /BaseConnectivityService/);
  assert.match(receiver, /BOOT_COMPLETED/);
  assert.match(receiver, /MY_PACKAGE_REPLACED/);
  assert.match(service, /HEARTBEAT_INTERVAL_MS = 2_000L/);
  assert.match(service, /START_STICKY/);
  assert.match(service, /燎原星火底座连接正在运行/);
});

test("persists backend threshold and the three phone display states", () => {
  const store = read("BaseConnectivityStateStore.kt");
  const client = read("BaseConnectivityClient.kt");

  assert.match(store, /AgriVideoCollectorBaseConnection/);
  assert.match(store, /offlineThresholdSeconds/);
  assert.match(store, /ONLINE/);
  assert.match(store, /RECONNECTING/);
  assert.match(store, /OFFLINE/);
  assert.match(client, /offlineThresholdSeconds/);
  assert.match(client, /receivedAt/);
});

test("writes connection state in the JSON string format used by AutoJS storages", () => {
  const store = read("BaseConnectivityStateStore.kt");

  assert.match(store, /putString\("lastSuccessAt", now\.toString\(\)\)/);
  assert.match(store, /putString\("offlineThresholdSeconds", .*\.toString\(\)\)/);
  assert.match(store, /putString\("lastResult", jsonString\("success"\)\)/);
  assert.match(store, /fun storedLong/);
  assert.doesNotMatch(store, /putLong\(/);
  assert.doesNotMatch(store, /putInt\(/);
});

test("starts each service session with a fresh reconnect timer", () => {
  const store = read("BaseConnectivityStateStore.kt");

  assert.match(store, /putString\("startedAt", now\.toString\(\)\)/);
  assert.match(store, /maxOf\(lastSuccessAt, startedAt\)/);
  assert.match(store, /lastSuccessAt >= startedAt/);
});

test("reuses the existing registered device identity without exposing secrets", () => {
  const protocol = read("BaseConnectivityProtocol.kt");
  const identity = read("BaseConnectivityIdentity.kt");
  assert.match(protocol, /autojs\.localstorage\.AgriVideoCollectorDevice/);
  assert.match(identity, /BaseConnectivityProtocol\.DEVICE_STORAGE_NAME/);
  assert.match(identity, /deviceId/);
  assert.match(identity, /deviceToken/);
  assert.doesNotMatch(identity, /registrationSecret/);
});

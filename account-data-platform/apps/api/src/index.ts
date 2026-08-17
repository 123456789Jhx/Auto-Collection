import { serve } from "bun";
import { app } from "./app";
import { config } from "./config";
import { syncRemoteScriptDefinitions } from "./services/remote-script-registry";
import { startPublishScheduler } from "./services/publish-scheduler.service";
import { startPublishStatusOutboxWorker } from "./services/publish-status-outbox.service";
import { startPublishInterfaceWorker } from "./services/publish-interface-worker";

await syncRemoteScriptDefinitions();
startPublishScheduler();
startPublishStatusOutboxWorker();
startPublishInterfaceWorker();

serve({
  port: config.apiPort,
  fetch: app.fetch
});

console.log(`API listening on http://localhost:${config.apiPort}`);

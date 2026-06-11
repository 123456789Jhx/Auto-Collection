import { serve } from "bun";
import { app } from "./app";
import { config } from "./config";

serve({
  port: config.apiPort,
  fetch: app.fetch
});

console.log(`API listening on http://localhost:${config.apiPort}`);

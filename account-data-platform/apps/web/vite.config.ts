import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const envDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "");

  return {
    envDir,
    plugins: [react()],
    server: {
      port: Number(env.WEB_PORT ?? 3022),
      allowedHosts: ["qk.dafengchan.top"],
      proxy: {
        "/api": {
          target: env.VITE_API_PROXY_TARGET ?? "http://localhost:3012",
          changeOrigin: true
        }
      }
    }
  };
});

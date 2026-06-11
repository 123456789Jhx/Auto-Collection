import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3020,
    proxy: {
      "/api": {
        target: "http://localhost:3010",
        changeOrigin: true
      }
    }
  }
});

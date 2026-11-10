import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.FRIENDS_API_PROXY || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/socket.io": {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
        timeout: 60_000,
        proxyTimeout: 60_000
      },
      "/api": {
        target: apiTarget,
        changeOrigin: true
      }
    }
  }
});

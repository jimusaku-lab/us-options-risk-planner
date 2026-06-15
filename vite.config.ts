import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/us-options-risk-planner/" : "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api/saxo": {
        target: "http://127.0.0.1:18787",
        changeOrigin: false,
      },
      "/api/market": {
        target: "http://127.0.0.1:18787",
        changeOrigin: false,
      },
      "/api/quote": {
        target: "http://127.0.0.1:18787",
        changeOrigin: false,
      },
      "/api/fx": {
        target: "http://127.0.0.1:18787",
        changeOrigin: false,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
    proxy: {
      "/bing": {
        target: "https://www.bing.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bing/, ""),
        headers: { "User-Agent": "Ganymede/0.1 (dev server)", "Accept-Language": "en-US,en;q=0.9" },
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});

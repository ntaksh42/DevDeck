import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // The desktop app renders in WebView2 (evergreen Chromium) and the browser
  // preview is exercised with Chromium via Playwright, so we can target a
  // modern baseline and let esbuild skip legacy downleveling. That trims the
  // startup bundle the webview has to parse before first paint.
  build: {
    target: "chrome110",
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Bind IPv4 loopback explicitly. With `false`, Node resolves `localhost`
    // to IPv6 `[::1]` on some Windows setups, but the Tauri WebView2 reaches
    // `http://localhost:1420` via IPv4 `127.0.0.1`, so the window stays blank.
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`, and the worktree folders
      //    under this checkout so sibling agent worktrees don't trigger endless
      //    HMR full-page reloads in this dev server. Anchored to this
      //    checkout's root: a `**/.worktrees/**` glob also matched the dev
      //    server's own files when it runs from inside a worktree, so edits
      //    there were never picked up.
      ignored: [
        "**/src-tauri/**",
        `${path.resolve(__dirname, ".claude").replace(/\\/g, "/")}/**`,
        `${path.resolve(__dirname, ".worktrees").replace(/\\/g, "/")}/**`,
      ],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 30000,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**", "src-tauri/**", ".claude/**", ".worktrees/**"],
  },
}));

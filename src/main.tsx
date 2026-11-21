import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
// Self-hosted fonts (bundled by Vite) so the desktop app renders offline
// without a webfont CDN. Atkinson Hyperlegible and BIZ UDPGothic are both
// designed for legibility: Latin text, then Japanese, then code and IDs.
import "@fontsource-variable/atkinson-hyperlegible-next/index.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/index.css";
import "@fontsource/biz-udpgothic/400.css";
import "@fontsource/biz-udpgothic/700.css";
import "./index.css";
import { applyTheme, loadThemePreference } from "./lib/theme";
import { applyFrameColor, loadFrameColor } from "./lib/frameColor";
import { applyUiScale, loadUiScale } from "./lib/uiScale";
import { applyUiFont, loadUiFont } from "./lib/uiFont";

// Apply the stored theme synchronously before React renders so the first paint
// already has the correct .dark class (no light-to-dark flash on startup).
applyTheme(loadThemePreference());
applyFrameColor(loadFrameColor());
applyUiScale(loadUiScale());
applyUiFont(loadUiFont());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 30 * 60_000,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);

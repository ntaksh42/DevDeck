import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
// Self-hosted variable font (bundled by Vite) so the desktop app renders the
// brand typeface offline without a webfont CDN.
import "@fontsource-variable/hanken-grotesk/index.css";
import "./index.css";
import { applyTheme, loadThemePreference } from "./lib/theme";

// Apply the stored theme synchronously before React renders so the first paint
// already has the correct .dark class (no light-to-dark flash on startup).
applyTheme(loadThemePreference());

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

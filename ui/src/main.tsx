import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { queryClient } from "./lib/query-client";
import { SettingsProvider } from "./lib/settings";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <SettingsProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </SettingsProvider>
  </StrictMode>,
);

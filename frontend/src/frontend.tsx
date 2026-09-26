import { scan } from "react-scan";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./web/App";
import { ErrorBoundary } from "./web/ErrorBoundary";

scan({ enabled: !navigator.webdriver, dangerouslyForceRunInProduction: true });

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, gcTime: Infinity } } });

const elem = document.getElementById("root");
if (!elem) throw new Error("missing #root");

const app = (
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);

(import.meta.hot.data.root ??= createRoot(elem)).render(app);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  void navigator.serviceWorker.register("/sw.js");
}

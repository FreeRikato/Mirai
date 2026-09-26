import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:3232", viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: "bun run build && bun src/index.ts",
    url: "http://localhost:3232/machines",
    env: { PORT: "3232", MIRAI_DB: ":memory:", NODE_ENV: "production" },
    reuseExistingServer: true,
  },
});

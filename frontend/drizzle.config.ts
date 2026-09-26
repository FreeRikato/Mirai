import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/hub/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "./data/mirai.db" },
});

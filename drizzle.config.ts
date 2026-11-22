import { defineConfig } from "drizzle-kit"

import { databasePath } from "./lib/db/path.ts"

try {
  process.loadEnvFile(".env.local")
} catch {}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle/sqlite",
  dialect: "sqlite",
  dbCredentials: { url: databasePath() },
})

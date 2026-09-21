import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)) } },
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" } },
      { extends: true, test: { name: "database", include: ["tests/database/**/*.test.ts"], environment: "node", testTimeout: 30000, hookTimeout: 60000, fileParallelism: false } },
    ],
  },
});

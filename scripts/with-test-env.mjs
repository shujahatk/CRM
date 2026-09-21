// Explicit compile/smoke-test configuration. These values cannot access a project.
// Never deploy artifacts built with this command. Real startup still validates real configuration.
import { spawnSync } from "node:child_process";
const port = process.env.PORT || "3210";
const commands = {
  build: ["node_modules/next/dist/bin/next", "build"],
  typegen: ["node_modules/next/dist/bin/next", "typegen"],
  start: ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port],
};
const command = commands[process.argv[2]];
if (!command) throw new Error("Expected build, typegen or start");
const result = spawnSync(process.execPath, command, { stdio: "inherit", env: {
  ...process.env, APP_ENV: "test", APP_BASE_URL: `http://127.0.0.1:${port}`,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only_not_a_credential",
  NEXT_TELEMETRY_DISABLED: "1",
} });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

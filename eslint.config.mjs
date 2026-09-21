import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { fixupConfigRules } from "@eslint/compat";
export default defineConfig([
  ...fixupConfigRules([...nextVitals, ...nextTypescript]),
  { rules: { "@typescript-eslint/no-explicit-any": "error" } },
  globalIgnores([".next/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts", ".local/**"]),
]);

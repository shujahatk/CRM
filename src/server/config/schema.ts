import { z } from "zod";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const origin = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && url.pathname === "/" &&
      (url.protocol === "https:" || (url.protocol === "http:" && localHosts.has(url.hostname)));
  } catch { return false; }
});
export const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: origin,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]{16,}$/),
});
const serverSchema = publicSchema.extend({
  APP_ENV: z.enum(["local", "test", "staging", "production"]),
  APP_BASE_URL: origin,
  LOG_LEVEL: z.enum(["info", "warn", "error"]).default("info"),
});
export function validateServerEnvironment(input: Record<string, string | undefined>) {
  const parsed = serverSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`);
  }
  const env = parsed.data;
  if (["staging", "production"].includes(env.APP_ENV) &&
      (new URL(env.APP_BASE_URL).protocol !== "https:" || new URL(env.NEXT_PUBLIC_SUPABASE_URL).protocol !== "https:" ||
       env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("test_only"))) {
    throw new Error("Hosted environments require HTTPS and real public project configuration");
  }
  if (input.VERCEL_ENV === "preview" && env.APP_ENV === "production") throw new Error("Preview must not use production configuration");
  const allowedPublic = new Set(Object.keys(publicSchema.shape));
  if (Object.keys(input).some((name) => name.startsWith("NEXT_PUBLIC_") && !allowedPublic.has(name))) {
    throw new Error("Unexpected public environment variable; public configuration is allowlisted");
  }
  return env;
}

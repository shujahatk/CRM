import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/server/config/env";
import type { Database } from "./types";

export async function createSupabaseServerClient(writable = false) {
  const env = serverEnv();
  const store = await cookies();
  return createServerClient<Database, "api">(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    db: { schema: "api" },
    cookieOptions: { sameSite: "lax", secure: new URL(env.APP_BASE_URL).protocol === "https:", path: "/" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        // Server Components cannot set cookies. Proxy refreshes first; actions/callbacks opt in explicitly.
        if (writable) values.forEach(({ name, value, options }) => store.set(name, value, options));
      },
    },
  });
}

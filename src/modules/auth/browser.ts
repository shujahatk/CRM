"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/server/database/types";
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Public authentication configuration missing");
  return createBrowserClient<Database, "api">(url, key, { db: { schema: "api" }, cookieOptions: { sameSite: "lax", path: "/", secure: location.protocol === "https:" } });
}

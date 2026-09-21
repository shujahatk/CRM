import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { serverEnv } from "@/server/config/env";
import { safeReturnPath } from "@/modules/auth/redirects";
import { log } from "@/server/telemetry/logger";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const code = query.get("code");
  if (code && code.length <= 2048) {
    const client = await createSupabaseServerClient(true);
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeReturnPath(query.get("next")), serverEnv().APP_BASE_URL));
  }
  log({ event: "auth.callback", outcome: "denied", requestId: crypto.randomUUID() });
  return NextResponse.redirect(new URL("/login?error=callback", serverEnv().APP_BASE_URL));
}

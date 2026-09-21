import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/server/config/env";
import type { Database } from "@/server/database/types";

export async function proxy(request: NextRequest) {
  const env = serverEnv();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const supabaseOrigin = new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin;
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace(/^http/, "ws")}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-request-id", crypto.randomUUID());
  headers.set("Content-Security-Policy", csp);
  let response = NextResponse.next({ request: { headers } });
  const client = createServerClient<Database, "api">(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    db: { schema: "api" },
    cookieOptions: { sameSite: "lax", secure: new URL(env.APP_BASE_URL).protocol === "https:", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        headers.set("cookie", request.cookies.toString());
        response = NextResponse.next({ request: { headers } });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await client.auth.getClaims();
  // Proxy refresh is not authorization. Every route/command checks session and membership again.
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("x-request-id", headers.get("x-request-id") ?? "");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };

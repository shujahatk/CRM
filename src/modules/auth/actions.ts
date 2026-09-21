"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { safeReturnPath } from "./redirects";
import { log } from "@/server/telemetry/logger";

export async function login(_state: { message: string }, form: FormData): Promise<{ message: string }> {
  const requestId = crypto.randomUUID();
  const parsed = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) }).safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { message: "Enter a valid email address and password." };
  const client = await createSupabaseServerClient(true);
  const { error } = await client.auth.signInWithPassword(parsed.data);
  if (error) {
    log({ event: "auth.login", outcome: "denied", requestId });
    return { message: "Unable to sign in. Check your credentials or try again later." };
  }
  log({ event: "auth.login", outcome: "success", requestId });
  redirect(safeReturnPath(form.get("next")));
}
export async function logout() {
  const client = await createSupabaseServerClient(true);
  const { error } = await client.auth.signOut({ scope: "local" });
  log({ event: "auth.logout", outcome: error ? "error" : "success", requestId: crypto.randomUUID() });
  if (error) throw new Error("Unable to sign out. Please try again.");
  redirect("/login");
}
export async function acceptInvitation(_state: { message: string }, form: FormData): Promise<{ message: string }> {
  const token = form.get("token");
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return { message: "Enter a valid invitation code." };
  const client = await createSupabaseServerClient(true);
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) redirect("/login?next=/invite");
  const { data, error } = await client.rpc("accept_invitation", { p_token: token });
  log({ event: "invitation.accept", outcome: error ? "denied" : "success", requestId: crypto.randomUUID() });
  if (error) return { message: "This invitation is unavailable. Confirm your account and ask your administrator for help." };
  redirect(`/${data}`);
}

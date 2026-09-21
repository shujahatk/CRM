import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { AppError, databaseError } from "@/server/errors";
import { safeReturnPath } from "@/modules/auth/redirects";

export async function authenticatedClient() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AppError("unauthenticated");
  return { client, user: data.user };
}
export async function requireUser(next = "/workspaces") {
  try { return await authenticatedClient(); }
  catch (error) {
    if (error instanceof AppError && error.code === "unauthenticated") redirect(`/login?next=${encodeURIComponent(safeReturnPath(next))}`);
    throw error;
  }
}
export async function requireWorkspace(id: string) {
  const { client, user } = await requireUser(`/${id}`);
  const access = await client.rpc("my_access");
  if (access.error) throw databaseError(access.error.code);
  const membership = access.data.find((row) => row.workspace_id === id);
  if (!membership) throw new AppError("forbidden");
  if (membership.role === "admin") {
    const { data, error } = await client.auth.getClaims();
    if (error || data?.claims.aal !== "aal2") redirect(`/mfa?next=/${id}`);
  }
  const workspace = await client.rpc("workspace_context", { p_workspace: id });
  if (workspace.error) throw databaseError(workspace.error.code);
  if (!workspace.data[0]) throw new AppError("forbidden");
  return { user, workspace: workspace.data[0] };
}

import { z } from "zod";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/server/auth/session";
import { WorkspaceShell } from "@/components/workspace-shell";
export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  if (!z.uuid().safeParse(workspace).success) notFound();
  const context = await requireWorkspace(workspace);
  return <WorkspaceShell workspace={context.workspace} email={context.user.email ?? "Account"}>{children}</WorkspaceShell>;
}

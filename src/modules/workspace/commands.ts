import "server-only";
import { z } from "zod";
import { authenticatedClient } from "@/server/auth/session";
import { AppError, databaseError } from "@/server/errors";
import { roleSchema } from "@/modules/auth/policies";

export const membershipChangeSchema = z.object({
  workspaceId: z.uuid(), memberId: z.uuid(), role: roleSchema, active: z.boolean(), version: z.number().int().positive(),
}).strict();
export async function changeMembership(input: unknown) {
  const parsed = membershipChangeSchema.safeParse(input);
  if (!parsed.success) throw new AppError("validation");
  const { client } = await authenticatedClient();
  const p = parsed.data;
  // User-scoped JWT; RPC independently checks active DB role, MFA, tenant and version.
  const { error } = await client.rpc("set_membership_role", { p_workspace: p.workspaceId, p_member: p.memberId,
    p_role: p.role, p_active: p.active, p_version: p.version });
  if (error) throw databaseError(error.code);
}

import { z } from "zod";
export const roleSchema = z.enum(["admin", "manager", "setter", "closer", "read_only"]);
export type MemberRole = z.infer<typeof roleSchema>;
export const roleLabels: Record<MemberRole, string> = {
  admin: "Admin", manager: "Manager", setter: "Setter", closer: "Closer", read_only: "Read-only",
};
// This helper consumes DB-verified membership only. Database commands independently enforce it.
export function canAdminister(role: MemberRole, active: boolean, aal: string): boolean {
  return active && role === "admin" && aal === "aal2";
}

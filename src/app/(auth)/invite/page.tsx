import { requireUser } from "@/server/auth/session";
import { InvitationForm } from "./invitation-form";
export default async function InvitePage() {
  await requireUser("/invite");
  return <main id="main" className="mx-auto mt-20 max-w-md rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-semibold">Join your workspace</h1><p className="muted my-4 text-sm">Enter the invitation code shared securely by your administrator. Your account email must match the invitation.</p><InvitationForm /></main>;
}

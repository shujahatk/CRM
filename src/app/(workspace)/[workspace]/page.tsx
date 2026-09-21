import { requireWorkspace } from "@/server/auth/session";
import { ShieldCheck } from "lucide-react";
export default async function WorkspaceHome({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  await requireWorkspace(workspace);
  return <><p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#116c58]">Your team’s workspace</p><h1 className="text-3xl font-semibold tracking-tight">A focused place to start.</h1><p className="muted mt-3 max-w-xl leading-relaxed">Your account and workspace access are ready. Sales tools will become available as the next phases are approved and released.</p>
    <section className="mt-10 flex min-h-80 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-center"><span className="mb-6 rounded-2xl bg-[#e8f3ee] p-4 text-[#116c58]"><ShieldCheck size={32} /></span><h2 className="text-xl font-semibold">Welcome to 80/20 CRM</h2><p className="muted mt-3 max-w-sm text-sm leading-relaxed">This workspace is prepared for your team. There’s no sales data here yet.</p><span className="mt-6 rounded-full border border-slate-200 px-4 py-1.5 text-xs text-slate-500">Platform foundation</span></section></>;
}

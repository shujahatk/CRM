import Link from "next/link";
import { ShieldCheck, LayoutDashboard, Users, Columns3, MessagesSquare, CheckSquare, Megaphone, FileText, ChartNoAxesCombined, Play, ClipboardList, BarChart3, Settings } from "lucide-react";
import { Brand } from "./brand";
import { logout } from "@/modules/auth/actions";
import { roleLabels } from "@/modules/auth/policies";
import type { Workspace } from "@/server/database/types";
const modules = [["Dashboard", LayoutDashboard], ["Leads", Users], ["Pipeline", Columns3], ["Conversations", MessagesSquare], ["Tasks", CheckSquare], ["Campaigns", Megaphone], ["Forms", FileText], ["Attribution", ChartNoAxesCombined], ["VSL Analytics", Play], ["EOD", ClipboardList], ["Reports", BarChart3], ["Settings", Settings]] as const;
export function WorkspaceShell({ workspace, email, children }: { workspace: Workspace; email: string; children: React.ReactNode }) {
  return <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
    <aside className="flex flex-col border-r border-slate-200 bg-white p-6 lg:min-h-screen"><Brand />
      <Link href="/workspaces" className="mt-8 rounded-lg border border-slate-200 p-3 text-sm font-medium">{workspace.name}<span className="muted mt-1 block text-xs">Switch workspace ↗</span></Link>
      <nav aria-label="Workspace" className="mt-7"><Link href={`/${workspace.id}`} aria-current="page" className="mb-4 flex items-center gap-3 rounded-lg bg-[#e8f3ee] px-3 py-2.5 text-sm font-semibold text-[#116c58]"><ShieldCheck size={18} /> Workspace</Link>
        <p className="muted mb-3 px-3 text-[10px] font-semibold uppercase tracking-widest">Coming in later phases</p>
        <ul className="grid grid-cols-2 gap-1 lg:grid-cols-1">{modules.map(([name, Icon]) => <li key={name}><span aria-disabled="true" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400"><Icon aria-hidden="true" size={17} />{name}</span></li>)}</ul>
      </nav>
      <div className="mt-8 border-t border-slate-200 pt-5 lg:mt-auto"><p className="truncate text-sm font-medium">{email}</p><p className="muted mt-1 text-xs">{workspace.is_owner ? "Owner" : roleLabels[workspace.role]}</p><div className="mt-4 flex justify-between text-xs"><Link href="/mfa" className="font-medium text-[#116c58]">Account security</Link><form action={logout}><button>Sign out</button></form></div></div>
    </aside>
    <div><header className="flex h-20 items-center justify-between border-b border-slate-200 bg-white px-6 lg:px-10"><p className="text-sm"><span className="muted">Workspace / </span>Overview</p><span className="rounded-full bg-[#e8f3ee] px-3 py-1 text-xs font-medium text-[#116c58]">Private workspace</span></header><main id="main" className="p-6 lg:p-10">{children}</main></div>
  </div>;
}

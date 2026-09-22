"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShieldCheck,
  LayoutDashboard,
  Users,
  Columns3,
  MessagesSquare,
  CheckSquare,
  Megaphone,
  FileText,
  ChartNoAxesCombined,
  Play,
  ClipboardList,
  BarChart3,
  Settings,
} from "lucide-react";
import { Brand } from "./brand";
import { logout } from "@/modules/auth/actions";
import { roleLabels } from "@/modules/auth/policies";
import type { Workspace } from "@/server/database/types";

const activeModules = [
  { name: "Overview", path: "", icon: ShieldCheck },
  { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { name: "Leads", path: "/leads", icon: Users },
  { name: "Pipeline", path: "/pipeline", icon: Columns3 },
  { name: "Tasks", path: "/tasks", icon: CheckSquare },
  { name: "EOD", path: "/eod", icon: ClipboardList },
  { name: "Reports", path: "/reports", icon: BarChart3 },
] as const;

const upcomingModules = [
  ["Conversations", MessagesSquare],
  ["Campaigns", Megaphone],
  ["Forms", FileText],
  ["Attribution", ChartNoAxesCombined],
  ["VSL Analytics", Play],
  ["Settings", Settings],
] as const;

export function WorkspaceShell({ workspace, email, children }: { workspace: Workspace; email: string; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr] bg-slate-50 text-slate-900 font-sans">
      <aside className="flex flex-col border-r border-slate-200 bg-white p-6 lg:min-h-screen">
        <Brand />
        <Link
          href="/workspaces"
          className="mt-6 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 text-sm font-medium transition hover:bg-slate-100 hover:border-slate-300"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800">{workspace.name}</span>
            <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-mono">v3.0</span>
          </div>
          <span className="text-xs text-slate-500 mt-1 block">Switch workspace &rarr;</span>
        </Link>

        <nav aria-label="Workspace Navigation" className="mt-6">
          <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Core Workspace</p>
          <ul className="mt-2 space-y-1">
            {activeModules.map(({ name, path, icon: Icon }) => {
              const fullPath = `/${workspace.id}${path}`;
              const isActive = path === "" ? pathname === fullPath : pathname.startsWith(fullPath);
              return (
                <li key={name}>
                  <Link
                    href={fullPath}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive
                        ? "bg-[#e8f3ee] text-[#116c58] font-semibold"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <Icon size={18} className={isActive ? "text-[#116c58]" : "text-slate-400"} />
                    {name}
                  </Link>
                </li>
              );
            })}
          </ul>

          <p className="mt-6 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Upcoming modules</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 lg:grid-cols-1">
            {upcomingModules.map(([name, Icon]) => (
              <li key={name}>
                <span
                  aria-disabled="true"
                  className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs text-slate-400 select-none cursor-not-allowed"
                >
                  <Icon aria-hidden="true" size={15} />
                  {name}
                </span>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-8 border-t border-slate-200 pt-5 lg:mt-auto">
          <p className="truncate text-sm font-medium text-slate-800">{email}</p>
          <p className="mt-0.5 text-xs text-slate-500">{workspace.is_owner ? "Workspace Owner" : roleLabels[workspace.role]}</p>
          <div className="mt-4 flex items-center justify-between text-xs">
            <Link href="/mfa" className="font-medium text-[#116c58] hover:underline">
              Security & MFA
            </Link>
            <form action={logout}>
              <button className="text-slate-500 hover:text-rose-600 transition">Sign out</button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex flex-col min-w-0">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 lg:px-8">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400 font-medium">80/20 CRM</span>
            <span className="text-slate-300">/</span>
            <span className="text-slate-700 font-medium">{workspace.name}</span>
          </div>
          <span className="rounded-full bg-[#e8f3ee] px-3 py-1 text-xs font-semibold text-[#116c58] border border-emerald-100">
            Sales workspace
          </span>
        </header>
        <main id="main" className="p-6 lg:p-8 flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { databaseError } from "@/server/errors";
import { logout } from "@/modules/auth/actions";
import { roleLabels } from "@/modules/auth/policies";
import { Brand } from "@/components/brand";
export default async function Workspaces() {
  const { client } = await requireUser();
  const { data, error } = await client.rpc("my_access");
  if (error) throw databaseError(error.code);
  return <main id="main" className="mx-auto max-w-3xl px-6 py-14"><Brand /><div className="mt-14 flex items-center justify-between gap-4"><h1 className="text-3xl font-semibold">Your workspaces</h1><form action={logout}><button className="text-sm font-medium text-[#116c58]">Sign out</button></form></div>
    <p className="muted mt-3 mb-8">Choose where you’d like to work.</p>
    {data.length ? <ul className="space-y-3">{data.map((w) => <li key={w.workspace_id}><Link className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-6 hover:border-[#116c58]" href={`/${w.workspace_id}`}><span className="font-semibold">{w.workspace_name}</span><span className="muted text-sm">{w.is_owner ? "Owner" : roleLabels[w.role]} →</span></Link></li>)}</ul> : <section className="rounded-xl border border-slate-200 bg-white p-8"><h2 className="font-semibold">No active workspace access</h2><p className="muted mt-2 text-sm">Ask your administrator to assign access, or accept an invitation below.</p></section>}
    <Link href="/invite" className="mt-8 inline-block text-sm font-medium text-[#116c58]">Accept a workspace invitation →</Link>
  </main>;
}

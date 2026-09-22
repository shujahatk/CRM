import {z} from 'zod';
import {requireWorkspace,authenticatedClient} from '@/server/auth/session';
import {databaseError} from '@/server/errors';
import {EodForm} from '@/components/sales/eod-form';
import {ReportView} from '@/components/sales/report-view';
export default async function EodPage({params,searchParams}:{params:Promise<{workspace:string}>;searchParams:Promise<{date?:string}>}){
 const{workspace}=await params;const context=await requireWorkspace(workspace);const query=await searchParams;
 const date=query.date??new Intl.DateTimeFormat('en-CA',{timeZone:context.workspace.timezone}).format(new Date());
 if(!z.iso.date().safeParse(date).success)return <p role="alert">Invalid date.</p>;
 const{client}=await authenticatedClient();const access=await client.rpc('my_access');if(access.error)throw databaseError(access.error.code);const member=access.data.find(m=>m.workspace_id===workspace);if(!member)throw databaseError('42501');
 const[history,report]=await Promise.all([client.rpc('eod_history',{p_workspace:workspace,p_date:date}),client.rpc('sales_report',{p_workspace:workspace,p_from:date,p_to:date,p_filters:{member_id:member.membership_id}})]);
 if(history.error)throw databaseError(history.error.code);if(report.error)throw databaseError(report.error.code);
 const latest=history.data[0];
 return <div className="mx-auto max-w-6xl space-y-6"><header><p className="text-xs font-semibold uppercase tracking-widest text-[#116c58]">Daily review</p><h1 className="mt-1 text-3xl font-bold">End of day</h1><p className="mt-2 text-sm text-slate-500">Your activity and historical sales credit · {context.workspace.timezone}</p></header><form className="flex gap-3"><label className="text-sm">Business date<input name="date" type="date" defaultValue={date} required className="ml-3 rounded border border-slate-300 p-2"/></label><button className="rounded-lg border border-slate-300 px-4 py-2 text-sm">View day</button></form><h2 className="font-semibold">Current calculation</h2><ReportView workspace={workspace} report={report.data} compact/>{context.workspace.role!=='read_only'&&<EodForm key={`${date}:${latest?.revision??0}`} workspace={workspace} date={date} latest={latest}/>}<section className="space-y-3"><h2 className="text-lg font-semibold">Revision history</h2>{history.data.length===0&&<p className="text-sm text-slate-500">No saved report for this day.</p>}{history.data.map(r=><details key={r.id} className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">Revision {r.revision} · {r.state} · {new Date(r.cutoff_at).toLocaleString('en',{timeZone:context.workspace.timezone})}</summary><div className="mt-4 space-y-4">{Object.entries(r.qualitative).map(([key,value])=><p key={key} className="whitespace-pre-wrap text-sm"><strong className="capitalize">{key.replaceAll('_',' ')}:</strong> {value}</p>)}<ReportView workspace={workspace} report={r.facts} compact/></div></details>)}</section></div>;
}

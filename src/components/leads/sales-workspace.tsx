"use client";
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {salesCommand,paymentCommand} from '@/modules/sales/commands';
import {money,salesActions} from '@/modules/sales/validation';
import type {SalesAction,SalesDetail} from '@/modules/sales/types';
import type {LostReasonRow,Member} from '@/server/database/types';
const field='mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm';
const button='rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50';
export function SalesWorkspace({workspace,lead,version,terminal,role,data,reasons,members}:{workspace:string;lead:string;version:number;terminal:boolean;role:string;data:SalesDetail;reasons:LostReasonRow[];members:Member[]}){
 const dialog=useRef<HTMLDialogElement>(null);const router=useRouter();
 const[action,setAction]=useState<SalesAction|'PAYMENT'>('SET');const[key,setKey]=useState('');const[pending,setPending]=useState(false);const[error,setError]=useState('');
 const writable=role!=='read_only';const financial=['admin','manager','closer'].includes(role);
 function open(next:SalesAction|'PAYMENT'){setAction(next);setKey(crypto.randomUUID());setError('');dialog.current?.showModal();}
 async function submit(form:FormData){
  setPending(true);setError('');
  try{
   const input:Record<string,string|number>={};for(const [name,value] of form)if(typeof value==='string'&&value.trim())input[name]=value.trim();
   for(const name of ['start_at','end_at','due_at','paid_at'])if(typeof input[name]==='string')input[name]=new Date(input[name]).toISOString();
   if(input.meeting_id){const meeting=data.meetings.find(m=>m.id===input.meeting_id);if(meeting)input.meeting_version=meeting.version;}
   if(['SET','RESCHEDULE'].includes(action))input.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
   const result=action==='PAYMENT'?await paymentCommand({workspace,lead,deal:input.deal_id,key,input:Object.fromEntries(Object.entries(input).filter(([name])=>name!=='deal_id'))}):await salesCommand({workspace,lead,action,version,key,input});
   if(result.error)setError(result.error);else{dialog.current?.close();router.refresh();}
  }catch{setError('Check the dates and try again.');}finally{setPending(false);}
 }
 return <section className="space-y-5" aria-label="Sales workspace">
  <div className="rounded-2xl border border-slate-200 bg-white p-5">
   <h2 className="text-lg font-semibold">Sales actions</h2><p className="mt-1 text-sm text-slate-500">Record the meeting or sales outcome. Each action preserves its history.</p>
   <div className="mt-4 flex flex-wrap gap-2">{salesActions.filter(a=>!['CANCEL','RESCHEDULE'].includes(a)).map(a=><button key={a} className={button} disabled={!writable||terminal||(!financial&&a.startsWith('CLOSE'))} onClick={()=>open(a)}>{a.replaceAll('_',' ')}</button>)}</div>
   {terminal&&<p className="mt-3 text-sm text-slate-500">This journey is closed. Its deal and financial records remain available below.</p>}
  </div>
  <div className="rounded-2xl border border-slate-200 bg-white p-5">
   <h2 className="text-lg font-semibold">Meetings</h2>
   {data.meetings.length===0?<p className="mt-3 text-sm text-slate-500">No meetings scheduled. Use SET to book one.</p>:<ul className="mt-3 divide-y divide-slate-100">{data.meetings.map(m=><li key={m.id} className="py-3"><div className="flex justify-between gap-3"><strong className="text-sm">{m.title}</strong><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{m.attendance==='unknown'?m.booking_state:m.attendance.replace('_',' ')}</span></div><p className="mt-1 text-xs text-slate-500">{new Date(m.start_at).toLocaleString('en',{timeZone:m.timezone})} – {new Date(m.end_at).toLocaleTimeString('en',{timeZone:m.timezone})} · {m.timezone}</p></li>)}</ul>}
   {writable&&!terminal&&data.meetings.some(m=>m.attendance==='unknown'&&m.booking_state!=='cancelled')&&<div className="mt-3 flex gap-2"><button className={button} onClick={()=>open('RESCHEDULE')}>Reschedule</button><button className={button} onClick={()=>open('CANCEL')}>Cancel booking</button></div>}
  </div>
  <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-semibold">Deals</h2>{data.deals.length===0?<p className="mt-3 text-sm text-slate-500">No sales outcomes recorded yet.</p>:data.deals.map(d=><article key={d.id} className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-sm font-semibold">{d.title} · {d.status}</p><p className="mt-1 text-sm">{money(d.deal_value_minor,d.currency)}</p><p className="mt-1 text-xs text-slate-500">Historical setter and closer credit is preserved after reassignment.</p></article>)}</div>
  <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Payments</h2>{financial&&data.deals.some(d=>d.status==='won')&&<button className={button} onClick={()=>open('PAYMENT')}>Record payment</button>}</div><p className="mt-1 text-xs text-slate-500">Internal records only. Pending amounts do not count as cash; refunds reduce cash.</p>{data.payments.length===0?<p className="mt-3 text-sm text-slate-500">No payment entries.</p>:<ul className="mt-3 divide-y divide-slate-100">{data.payments.map(p=><li className="flex justify-between gap-2 py-3 text-sm" key={p.id}><span>{p.kind} · {new Date(p.paid_at).toLocaleDateString()}</span><strong>{money(p.amount_minor,p.currency)}</strong></li>)}</ul>}</div>
  <dialog ref={dialog} aria-labelledby="sales-dialog-title" className="m-auto max-h-[90vh] w-[min(94vw,520px)] rounded-2xl border border-slate-200 p-6 shadow-xl backdrop:bg-slate-900/40" onCancel={e=>{if(pending)e.preventDefault();}}>
   <h2 id="sales-dialog-title" className="text-xl font-bold">{action.replaceAll('_',' ')}</h2>
   <form key={key} action={submit} className="mt-5 space-y-4">
    {['SET','CLOSE_WON'].includes(action)&&<label className="block text-sm">Title<input autoFocus name="title" required maxLength={240} className={field}/></label>}
    {['CONFIRM','SHOW','NO_SHOW','CANCEL','RESCHEDULE'].includes(action)&&<label className="block text-sm">Meeting<select required name="meeting_id" className={field}><option value="">Select meeting</option>{data.meetings.filter(m=>m.attendance==='unknown'&&m.booking_state!=='cancelled').map(m=><option key={m.id} value={m.id}>{m.title} · {m.booking_state}</option>)}</select></label>}
    {['SET','RESCHEDULE'].includes(action)&&<><p className="text-xs text-slate-500">Enter times in your browser’s local timezone.</p><label className="block text-sm">Starts<input name="start_at" type="datetime-local" required className={field}/></label><label className="block text-sm">Ends<input name="end_at" type="datetime-local" required className={field}/></label></>}
    {action==='SET'&&<label className="block text-sm">Closer (optional)<select name="closer_id" className={field}><option value="">Keep current assignment</option>{members.filter(m=>m.status==='active'&&['closer','admin','manager'].includes(m.role)).map(m=><option key={m.id} value={m.id}>{m.role} · {m.id.slice(0,8)}</option>)}</select></label>}
    {['FOLLOW_UP','NURTURE'].includes(action)&&<><label className="block text-sm">Next action<input required name="task_title" maxLength={240} className={field}/></label><label className="block text-sm">Due (your local time)<input required name="due_at" type="datetime-local" className={field}/></label></>}
    {['CLOSE_WON','CLOSE_LOST','PAYMENT'].includes(action)&&<label className="block text-sm">Currency<input required name="currency" placeholder="USD" pattern="[A-Z]{3}" maxLength={3} className={field}/></label>}
    {['CLOSE_WON','PAYMENT'].includes(action)&&<label className="block text-sm">Amount in minor units<input required name="amount_minor" inputMode="numeric" pattern="[0-9]{1,18}" placeholder="10000 = USD 100.00" className={field}/></label>}
    {action==='CLOSE_LOST'&&<label className="block text-sm">Lost reason<select required name="lost_reason_id" className={field}><option value="">Select reason</option>{reasons.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>}
    {action==='CLOSE_WON'&&<fieldset className="space-y-3 rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm">Optional cash received now</legend><label className="block text-sm">Cash in minor units<input name="payment_minor" inputMode="numeric" pattern="[1-9][0-9]{0,17}" className={field}/></label><label className="block text-sm">Payment method<input name="payment_method" maxLength={80} className={field}/></label></fieldset>}
    {action==='PAYMENT'&&<><label className="block text-sm">Deal<select name="deal_id" required className={field}>{data.deals.filter(d=>d.status==='won').map(d=><option key={d.id} value={d.id}>{d.title} · {d.currency}</option>)}</select></label><label className="block text-sm">Entry type<select name="kind" className={field}><option value="paid">Paid receipt</option><option value="recorded">Pending / recorded</option><option value="refund">Refund (permission required)</option><option value="void">Void pending entry (permission required)</option></select></label><label className="block text-sm">Method<input name="method" required maxLength={80} placeholder="Bank transfer" className={field}/></label><label className="block text-sm">Original entry (settlement, refund or void)<select name="original_entry_id" className={field}><option value="">New receipt / pending record</option>{data.payments.filter(p=>['paid','recorded'].includes(p.kind)).map(p=><option key={p.id} value={p.id}>{p.kind} · {money(p.amount_minor,p.currency)} · {p.id.slice(0,8)}</option>)}</select></label><label className="block text-sm">Correction reason<input name="reason" maxLength={500} className={field}/></label></>}
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" disabled={pending} className={button} onClick={()=>dialog.current?.close()}>Cancel</button><button disabled={pending} className="rounded-lg bg-[#116c58] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending?'Saving…':'Save record'}</button></div>
   </form>
  </dialog>
 </section>;
}

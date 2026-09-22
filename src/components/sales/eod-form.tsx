"use client";
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {submitEod} from '@/modules/sales/commands';
import type {EodRevision} from '@/modules/sales/types';
const fields=['wins','blockers','observations','help_needed','next_day_priority'] as const;
export function EodForm({workspace,date,latest}:{workspace:string;date:string;latest?:EodRevision}){
 const [key]=useState(()=>crypto.randomUUID());const[error,setError]=useState('');const[pending,setPending]=useState(false);const router=useRouter();
 async function save(form:FormData){setPending(true);setError('');const result=await submitEod({workspace,date,revision:latest?.revision??0,key,state:latest&&latest.state!=='draft'?'amended':String(form.get('state')),qualitative:Object.fromEntries(fields.map(f=>[f,String(form.get(f)??'')]))});setPending(false);if(result.error)setError(result.error);else router.refresh();}
 return <form action={save} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{latest&&latest.state!=='draft'?'Amend report':'Your end-of-day notes'}</h2><p className="text-sm text-slate-500">Numbers are derived from CRM facts. Saving creates a frozen revision; earlier revisions remain available.</p>{fields.map(f=><label key={f} className="block text-sm capitalize">{f.replaceAll('_',' ')}<textarea name={f} defaultValue={latest?.qualitative[f]??''} maxLength={2000} rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 p-2.5"/></label>)}{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}<div className="flex gap-2">{(!latest||latest.state==='draft')&&<button disabled={pending} name="state" value="draft" className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Save draft</button>}<button disabled={pending} name="state" value="submitted" className="rounded-lg bg-[#116c58] px-4 py-2 text-sm font-semibold text-white">{pending?'Saving…':latest&&latest.state!=='draft'?'Save amendment':'Submit EOD'}</button></div></form>;
}

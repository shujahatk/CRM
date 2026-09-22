import {z} from 'zod';
export const salesActions=['SET','CONFIRM','SHOW','NO_SHOW','CANCEL','RESCHEDULE','FOLLOW_UP','CLOSE_WON','CLOSE_LOST','NURTURE'] as const;
export const commandSchema=z.object({workspace:z.uuid(),lead:z.uuid(),action:z.enum(salesActions),version:z.number().int().positive(),key:z.uuid(),input:z.record(z.string(),z.union([z.string().max(500),z.number().int()]))});
export const paymentSchema=z.object({workspace:z.uuid(),lead:z.uuid(),deal:z.uuid(),key:z.uuid(),input:z.object({kind:z.enum(['recorded','paid','refund','void']),amount_minor:z.string().regex(/^[1-9][0-9]{0,17}$/),currency:z.string().regex(/^[A-Z]{3}$/),method:z.string().min(1).max(80),original_entry_id:z.uuid().optional(),reason:z.string().max(500).optional(),paid_at:z.iso.datetime().optional()})});
// Money is displayed without Number conversion; even BIGINT values remain exact.
export function money(minor:string,currency:string){
 const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits ?? 2;
 const negative=minor.startsWith('-');const raw=minor.replace(/^-/,'').padStart(digits+1,'0');
 return `${currency} ${negative?'-':''}${digits?raw.slice(0,-digits)+'.'+raw.slice(-digits):raw}`;
}
export function percentage(numerator:number,denominator:number){return denominator===0?'—':`${(100*numerator/denominator).toFixed(1)}%`;}

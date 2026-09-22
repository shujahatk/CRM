"use server";
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {authenticatedClient} from '@/server/auth/session';
import {databaseError,publicError} from '@/server/errors';
import {log} from '@/server/telemetry/logger';
import {commandSchema,paymentSchema} from './validation';
function refresh(workspace:string,lead?:string){for(const path of ['dashboard','leads','pipeline','tasks','reports','eod'])revalidatePath(`/${workspace}/${path}`);if(lead)revalidatePath(`/${workspace}/leads/${lead}`);}
export async function salesCommand(input:unknown):Promise<{error?:string;success?:boolean}>{
 const parsed=commandSchema.safeParse(input);if(!parsed.success)return{error:'Check the action fields.'};
 try{const p=parsed.data;const {client}=await authenticatedClient();const {error}=await client.rpc('sales_command',{p_workspace:p.workspace,p_lead:p.lead,p_action:p.action,p_version:p.version,p_command_key:p.key,p_input:p.input});if(error){log({event:'sales.command',outcome:'error',code:error.code});throw databaseError(error.code);}refresh(p.workspace,p.lead);return{success:true};}catch(error){return{error:publicError(error).message};}
}
export async function paymentCommand(input:unknown):Promise<{error?:string;success?:boolean}>{
 const parsed=paymentSchema.safeParse(input);if(!parsed.success)return{error:'Enter positive integer minor units, currency and payment method.'};
 try{const p=parsed.data;const {client}=await authenticatedClient();const {error}=await client.rpc('payment_command',{p_workspace:p.workspace,p_lead:p.lead,p_deal:p.deal,p_command_key:p.key,p_input:p.input});if(error){log({event:'payment.command',outcome:'error',code:error.code});throw databaseError(error.code);}refresh(p.workspace,p.lead);return{success:true};}catch(error){return{error:publicError(error).message};}
}
const eodSchema=z.object({workspace:z.uuid(),date:z.iso.date(),revision:z.number().int().nonnegative(),key:z.uuid(),state:z.enum(['draft','submitted','amended']),qualitative:z.object({wins:z.string().max(2000),blockers:z.string().max(2000),observations:z.string().max(2000),help_needed:z.string().max(2000),next_day_priority:z.string().max(2000)})});
export async function submitEod(input:unknown):Promise<{error?:string;success?:boolean}>{
 const parsed=eodSchema.safeParse(input);if(!parsed.success)return{error:'Check the report fields.'};
 try{const p=parsed.data;const{client}=await authenticatedClient();const{error}=await client.rpc('submit_eod',{p_workspace:p.workspace,p_date:p.date,p_revision:p.revision,p_command_key:p.key,p_qualitative:p.qualitative,p_state:p.state});if(error)throw databaseError(error.code);refresh(p.workspace);return{success:true};}catch(error){return{error:publicError(error).message};}
}

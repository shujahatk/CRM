export type SalesAction = 'SET'|'CONFIRM'|'SHOW'|'NO_SHOW'|'CANCEL'|'RESCHEDULE'|'FOLLOW_UP'|'CLOSE_WON'|'CLOSE_LOST'|'NURTURE';
export type Meeting = {id:string;title:string;start_at:string;end_at:string;timezone:string;booking_state:string;attendance:string;version:number};
export type Deal = {id:string;title:string;status:string;currency:string;deal_value_minor:string;setter_credit_membership_id:string|null;closer_credit_membership_id:string|null};
export type Payment = {id:string;deal_id:string;kind:string;amount_minor:string;currency:string;paid_at:string;original_entry_id:string|null};
export type SalesDetail = {meetings:Meeting[];deals:Deal[];payments:Payment[]};
export type SalesReport = {
 from:string;to:string;timezone:string;as_of:string;outcomes:Partial<Record<SalesAction,number>>;
 currencies:{currency:string;deal_value_minor:string;cash_minor:string}[];
 leads:{created:number;worked:number};tasks:{outstanding:number;overdue:number;completed:number};
 stage_distribution:{stage:string;count:number}[];
 denominators:{attendance_resolved:number;attendance_showed:number;closed_decisions:number;closed_won:number};
 performance:{membership_id:string;credit_role:string;action:string;count:number}[];
 drilldown:{activity_id:string;lead_id:string|null;action:string;at:string}[];offset:number;
};
export type EodRevision = {id:string;revision:number;state:string;qualitative:Record<string,string>;facts:SalesReport;cutoff_at:string};

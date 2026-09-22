import {expect,it} from 'vitest';
import {money,percentage,paymentSchema,commandSchema} from '@/modules/sales/validation';
it('large money never passes through floating point',()=>{expect(money('9007199254740993','USD')).toBe('USD 90071992547409.93');});
it('currency minor unit precision is respected',()=>{expect(money('100','JPY')).toBe('JPY 100');expect(money('100','KWD')).toBe('KWD 0.100');expect(money('-50','USD')).toBe('USD -0.50');});
it('empty conversion cohort never displays zero or 100 percent',()=>{expect(percentage(0,0)).toBe('—');expect(percentage(1,2)).toBe('50.0%');});
it('sales validation rejects client role and missing expected version as authority',()=>{expect(commandSchema.safeParse({role:'admin',action:'CLOSE_WON'}).success).toBe(false);});
it('payment rejects fractional authoritative amounts',()=>{expect(paymentSchema.safeParse({workspace:crypto.randomUUID(),lead:crypto.randomUUID(),deal:crypto.randomUUID(),key:crypto.randomUUID(),input:{kind:'paid',amount_minor:'10.50',currency:'USD',method:'cash'}}).success).toBe(false);});

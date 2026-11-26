import {afterEach,describe,it,expect,vi} from 'vitest';
import {sendEmail} from '../supabase/functions/ti-flow/mail';
import {mailStatusLabel} from '../src/domain';
afterEach(()=>vi.unstubAllGlobals());
describe('Mail acceptance receipts',()=>{
 it('retains the provider ID and an idempotency key without mistaking acceptance for inbox delivery',async()=>{
  const env:Record<string,string>={RESEND_API_KEY:'not-a-real-key',MAIL_FROM:'Flow <no-reply@example.invalid>'};vi.stubGlobal('Deno',{env:{get:(key:string)=>env[key]}});
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'provider-receipt'})});vi.stubGlobal('fetch',fetch);
  expect(await sendEmail('job-id','recipient@example.invalid',{subject:'Teste',html:'<p>Teste</p>',text:'Teste'})).toBe('provider-receipt');
  expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('ti-flow-job-id');expect(mailStatusLabel('enviado')).toBe('aceito pelo serviço de envio');
 });
});

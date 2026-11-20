import {afterEach,describe,it,expect,vi} from 'vitest';
import {asaasRequest,billingConfigured,invoiceUrl,paymentStatus,subscriptionPayload} from '../supabase/functions/ti-flow/billing';
import {contactInput,contactContent,contactDestinations} from '../supabase/functions/ti-flow/contact';
afterEach(()=>{vi.unstubAllGlobals();});
describe('Asaas request boundaries',()=>{
 it('uses server amounts and cycles and never accepts raw card data',()=>{
  const monthly=subscriptionPayload({id:'known-id',method:'CREDIT_CARD',amount_cents:5990,months:1},'customer-id','https://flow.automacoes.tec.br','2026-11-20');expect(monthly).toMatchObject({value:59.90,cycle:'MONTHLY',billingType:'CREDIT_CARD',externalReference:'known-id',pixAutomaticAuthorizationMode:'DISABLED'});expect(monthly).not.toHaveProperty('creditCard');
  expect(subscriptionPayload({id:'id',method:'PIX',amount_cents:59900,months:12},'c','https://example.invalid','2026-11-20')).toMatchObject({value:599,cycle:'YEARLY'});expect(()=>subscriptionPayload({id:'id',method:'BOLETO',amount_cents:5990,months:1},'c','https://example.invalid','2026-11-20')).toThrow();
 });
 it('keeps the key on the server, uses Sandbox explicitly and sends no GET request body',async()=>{
  const env:Record<string,string>={ASAAS_API_KEY:'test-key-not-a-credential',ASAAS_ENVIRONMENT:'sandbox',ASAAS_WEBHOOK_TOKEN:'test-token-not-a-credential'};vi.stubGlobal('Deno',{env:{get:(key:string)=>env[key]}});const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({data:[]})});vi.stubGlobal('fetch',fetch);expect(billingConfigured()).toBe(true);await asaasRequest('/webhooks');expect(fetch).toHaveBeenCalledWith('https://api-sandbox.asaas.com/v3/webhooks',expect.objectContaining({method:'GET'}));expect(fetch.mock.calls[0][1].body).toBeUndefined();env.ASAAS_ENVIRONMENT='invalid';expect(billingConfigured()).toBe(false);await expect(asaasRequest('/webhooks')).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('accepts only HTTPS invoice URLs at the payment provider',()=>{expect(invoiceUrl('https://sandbox.asaas.com/i/test')).toBeTruthy();for(const url of ['javascript:alert(1)','https://asaas.com.example.invalid/i/test','http://asaas.com/i/test','https://example.invalid/'])expect(invoiceUrl(url)).toBe(null);});
 it('does not mistake card authorization for paid capture',()=>{expect(paymentStatus('AUTHORIZED')).toBe('pending');expect(paymentStatus('CONFIRMED')).toBe('paid');expect(paymentStatus('RECEIVED')).toBe('paid');expect(paymentStatus('CHARGEBACK_REQUESTED')).toBe('disputed');expect(paymentStatus('REFUNDED')).toBe('refunded');});
});
describe('Public contact form',()=>{
 const valid={name:'Pessoa Teste',email:'visitor@example.invalid',category:'commercial',subject:'Conhecer o Flow',message:'Gostaria de conhecer o plano mensal.',consent:true};
 it('validates consent, category, length and e-mail without accepting an arbitrary recipient',()=>{expect(contactInput({...valid,to:'intruder@example.invalid'})).not.toHaveProperty('to');expect(contactDestinations.commercial).toBe('comercial@flow.automacoes.tec.br');expect(()=>contactInput({...valid,category:'intruder@example.invalid'})).toThrow();expect(()=>contactInput({...valid,consent:false})).toThrow();expect(()=>contactInput({...valid,subject:'Hello\r\nBcc: x@y.z'})).toThrow();expect(()=>contactInput({...valid,message:'curta'})).toThrow();});
 it('escapes messages and identifies the category in the notification',()=>{const input=contactInput({...valid,message:'Mensagem <script>alert(1)</script>'});const content=contactContent(input);expect(content.html).not.toContain('<script>');expect(content.html).toContain('&lt;script&gt;');expect(content.html).toContain('comercial@flow.automacoes.tec.br');expect(content.text).toContain('visitor@example.invalid');});
});

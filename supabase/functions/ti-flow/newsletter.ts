import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.119.0';
import {escapeHtml,sha256,secureToken,encryptPayload,decryptPayload} from './policy.ts';
import {setting} from './settings.ts';

export const NEWS_FROM='TI Flow Novidades <news-flow@flow.automacoes.tec.br>';
export const validEmail=(value:string)=>value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validToken=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
export function newsletterContent(subject:string,content:string,unsubscribe:string,base:string){
 const url=`${base}/blog/newsletter?unsubscribe=${encodeURIComponent(unsubscribe)}`;
 return {subject,html:`<!doctype html><html lang="pt-BR"><body style="background:#f3f6fc;color:#25344c;font-family:Arial,sans-serif;padding:24px"><main style="max-width:560px;margin:auto;background:white;padding:32px;border-radius:16px"><strong style="font-size:28px">tiflow<span style="color:#4774e7">.</span></strong><p>NOTÍCIAS DO SEU FLUXO</p><h1>${escapeHtml(subject)}</h1>${content.split(/\n\s*\n/).map(p=>`<p style="line-height:1.8;white-space:pre-line">${escapeHtml(p)}</p>`).join('')}<p><a href="${escapeHtml(base)}/blog">Visitar o blog do TI Flow</a></p><hr><p style="font-size:13px;line-height:1.7">Você confirmou sua inscrição para receber novidades do TI Flow.<br><a href="${escapeHtml(url)}">Cancelar inscrição</a> a qualquer momento.</p></main></body></html>`,text:`${subject}\n\n${content}\n\nBlog: ${base}/blog\nCancelar inscrição: ${url}`,headers:{'List-Unsubscribe':`<${url}>`}};
}
function checked<T>(result:{data:T;error:unknown}):T {if(result.error)throw new Error('Não foi possível concluir a operação da newsletter.');return result.data;}
export async function requestSubscription(db:SupabaseClient,email:string){
 const token=secureToken(),unsubscribe=secureToken(),key=setting('MAIL_ENCRYPTION_KEY')!;
 checked(await db.rpc('newsletter_request',{p_email:email,p_hash:await sha256(token),p_unsubscribe_hash:await sha256(unsubscribe),p_unsubscribe:await encryptPayload({token:unsubscribe},key),p_payload:await encryptPayload({token},key)}));
}
export async function processNewsletter(db:SupabaseClient){
 // Existing Cron invokes this after transactional access messages.
 if(!setting('RESEND_API_KEY'))return {sent:0,failed:0};
 const jobs=checked(await db.rpc('claim_newsletter_jobs'))??[];let sent=0,failed=0;
 for(const job of jobs){let success=false;
  try{
   const s=checked(await db.from('newsletter_subscribers').select('*').eq('id',job.subscriber_id).single());
   const invalid=job.kind==='campaign'?s.state!=='confirmed':s.state!=='pending'||s.confirmation_hash!==job.confirmation_hash||new Date(s.confirmation_expires_at)<new Date();
   if(invalid){checked(await db.from('newsletter_jobs').update({state:'cancelled',encrypted_payload:null}).eq('id',job.id).eq('claim_token',job.claim_token));continue;}
   const base=setting('APP_URL')!,key=setting('MAIL_ENCRYPTION_KEY')!;let content;
   if(job.kind==='confirmation'){
    const {token}=await decryptPayload<{token:string}>(job.encrypted_payload,key),url=`${base}/blog/newsletter?confirm=${encodeURIComponent(token)}`;
    content={subject:'Confirme sua inscrição · TI Flow',html:`<div style="font-family:Arial,sans-serif;max-width:540px;margin:32px auto;line-height:1.8;color:#25344c"><h1>Novidades para o seu fluxo.</h1><p>Você solicitou receber dicas e novidades do TI Flow.</p><p><a href="${escapeHtml(url)}">Confirmar minha inscrição</a></p><p>O link vale por 24 horas. Você ainda precisará confirmar na página aberta. Se não fez esta solicitação, ignore este e-mail. Nenhuma conta no sistema será criada.</p></div>`,text:`Confirme sua inscrição nas novidades do TI Flow: ${url}\nLink válido por 24 horas. Se não solicitou, ignore.`};
   }else{
    const c=checked(await db.from('newsletter_campaigns').select('subject,content').eq('id',job.campaign_id).single());
    if(!c)throw new Error('Edition unavailable');
    const {token}=await decryptPayload<{token:string}>(s.encrypted_unsubscribe,key);content=newsletterContent(c.subject,c.content,token,base);
   }
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${setting('RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`flow-news-${job.id}`},body:JSON.stringify({from:NEWS_FROM,to:[s.email],...content}),signal:AbortSignal.timeout(6000)});
   if(!response.ok)throw new Error('Email delivery failed');success=true;sent++;
  }catch{failed++;/* Do not log recipient addresses, tokens or provider responses. */}
  checked(await db.rpc('finish_newsletter_job',{p_id:job.id,p_claim:job.claim_token,p_success:success}));
  await new Promise(resolve=>setTimeout(resolve,700));
 }
 checked(await db.from('newsletter_jobs').update({state:'failed',encrypted_payload:null}).lt('created_at',new Date(Date.now()-22*3600000).toISOString()).in('state',['scheduled','sending']));
 // Remove abandoned requests; keep opt-out records so cancellation is respected.
 checked(await db.from('newsletter_subscribers').delete().eq('state','pending').lt('requested_at',new Date(Date.now()-7*86400000).toISOString()));
 return {sent,failed};
}
export async function newsletterOverview(db:SupabaseClient){return checked(await db.rpc('newsletter_overview'));}

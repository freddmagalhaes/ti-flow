import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.119.0';
import {escapeHtml} from './policy.ts';
import {setting} from './settings.ts';
import {validEmail} from './newsletter.ts';
export const contactDestinations={commercial:'comercial@flow.automacoes.tec.br',question:'contato@flow.automacoes.tec.br',support:'ti@flow.automacoes.tec.br'};
export function contactInput(input:Record<string,unknown>){
 const name=String(input.name??'').trim(),email=String(input.email??'').trim().toLowerCase(),category=String(input.category??''),subject=String(input.subject??'').trim(),message=String(input.message??'').trim();
 if(name.length<2||name.length>160||!validEmail(email)||!Object.hasOwn(contactDestinations,category)||subject.length<3||subject.length>160||/[\r\n]/.test(subject)||message.length<10||message.length>5000||input.consent!==true)throw new Error('Confira nome, e-mail, assunto e mensagem e autorize o envio.');
 return {name,email,category:category as keyof typeof contactDestinations,subject,message};
}
export function contactContent(input:ReturnType<typeof contactInput>){return {subject:`TI Flow · ${input.category==='commercial'?'Comercial':input.category==='question'?'Dúvida':'Suporte'} · ${input.subject}`,html:`<main style="font-family:Arial,sans-serif;max-width:620px;line-height:1.8"><h1>Nova mensagem pelo TI Flow</h1><p><strong>Canal:</strong> ${contactDestinations[input.category]}</p><p><strong>Nome:</strong> ${escapeHtml(input.name)}<br><strong>E-mail para resposta:</strong> ${escapeHtml(input.email)}</p><h2>${escapeHtml(input.subject)}</h2><p style="white-space:pre-wrap">${escapeHtml(input.message)}</p></main>`,text:`Nome: ${input.name}\nE-mail: ${input.email}\n\n${input.subject}\n\n${input.message}`};}
export async function processContactMessages(db:SupabaseClient){
 if(!setting('RESEND_API_KEY'))return {sent:0,failed:0};const claimed=await db.rpc('claim_contact_messages');if(claimed.error)throw new Error('Contact queue unavailable');let sent=0,failed=0;
 for(const job of claimed.data??[]){let success=false;try{const content=contactContent(job);const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${setting('RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`flow-contact-${job.id}`},body:JSON.stringify({from:setting('MAIL_FROM'),to:[setting('CONTACT_NOTIFICATION_EMAIL')??contactDestinations[job.category as keyof typeof contactDestinations]],reply_to:job.email,...content}),signal:AbortSignal.timeout(6000)});if(!result.ok)throw new Error('Contact delivery failed');success=true;sent++;}catch{failed++;}const done=await db.rpc('finish_contact_message',{p_id:job.id,p_claim:job.claim_token,p_success:success});if(done.error)throw new Error('Contact queue update failed');await new Promise(r=>setTimeout(r,700));}
 await db.from('contact_messages').update({state:'failed'}).lt('created_at',new Date(Date.now()-22*3600000).toISOString()).in('state',['scheduled','sending']);return {sent,failed};
}

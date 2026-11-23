import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.119.0';
import {escapeHtml} from './policy.ts';
import {setting} from './settings.ts';
type CardNotice={id:string;code:string;title:string;priority:string;due_date:string};
export type ActivityNotice={company:string;kind:string;recipient_id:string;timezone:string;cards:CardNotice[]};
export function notificationSettings(input:Record<string,unknown>){
 const enabled=input.enabled,hour=input.hour,timezone=input.timezone;
 if(typeof enabled!=='boolean'||!Number.isInteger(hour)||Number(hour)<8||Number(hour)>17||typeof timezone!=='string'||!['America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha'].includes(timezone))throw new Error('Confira o fuso e o horário comercial, entre 8h e 17h.');
 return {activity_emails_enabled:enabled,notification_hour:hour as number,notification_timezone:timezone};
}
export function activityEmailContent(context:ActivityNotice,base:string){
 const labels:Record<string,string>={assigned:'Uma atividade foi atribuída a você',due_soon:'Atividade próxima do prazo',overdue:'O prazo da atividade venceu',overdue_digest:'Resumo das suas atividades em atraso'};
 const priority:Record<string,string>={low:'Baixa',medium:'Média',high:'Alta',urgent:'Urgente'};
 const title=labels[context.kind]??'Atualização de atividades';
 const cards=context.cards.map(c=>{const link=new URL('/entrar',base);link.searchParams.set('atividade',c.id);return {...c,link:link.toString(),date:c.due_date.split('-').reverse().join('/'),priority:priority[c.priority]??c.priority};});
 const html=`<main style="font-family:Arial,sans-serif;max-width:620px;line-height:1.7;color:#25344c"><h1>${title}</h1><p>Empresa: <strong>${escapeHtml(context.company)}</strong></p>${cards.map(c=>`<section style="padding:16px;margin:16px 0;background:#f4f7fb;border-radius:10px"><small>${escapeHtml(c.code)}</small><h2>${escapeHtml(c.title)}</h2><p>Prioridade: ${escapeHtml(c.priority)}<br>Término previsto: ${c.date}</p><a href="${escapeHtml(c.link)}">Abrir atividade no Flow</a></section>`).join('')}<p>O prazo considera a data de término prevista no fuso ${escapeHtml(context.timezone)}. Entre na sua conta para consultar o card. Você pode ajustar os avisos em Configurações → Notificações de atividades.</p><footer>TI Flow · Aviso automático de trabalho</footer></main>`;
 return {subject:`TI Flow · ${title}`,html,text:`${title}\nEmpresa: ${context.company}\n\n${cards.map(c=>`${c.code} · ${c.title}\nPrioridade: ${c.priority}\nTérmino: ${c.date}\n${c.link}`).join('\n\n')}\n\nPreferências: Configurações → Notificações de atividades.`};
}
export async function processActivityEmails(db:SupabaseClient){
 if(!setting('RESEND_API_KEY')||!setting('APP_URL')||!setting('MAIL_FROM'))return {sent:0,failed:0,cancelled:0};
 const jobs=await db.rpc('claim_activity_emails');if(jobs.error)throw new Error('Activity notification queue unavailable');let sent=0,failed=0,cancelled=0;
 for(const job of jobs.data??[]){let outcome='failed';try{
  const context=await db.rpc('activity_email_context',{p_id:job.id,p_claim:job.claim_token});if(context.error)throw new Error('Activity notification unavailable');
  const notice=context.data as ActivityNotice|null;
  if(!notice?.cards?.length){outcome='cancelled';cancelled++;}else{
   const user=await db.auth.admin.getUserById(notice.recipient_id);if(user.error||!user.data.user?.email)throw new Error('Recipient unavailable');
   const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${setting('RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`flow-activity-${job.id}`},body:JSON.stringify({from:setting('MAIL_FROM'),to:[user.data.user.email],...activityEmailContent(notice,setting('APP_URL')!)}),signal:AbortSignal.timeout(6000)});
   if(!result.ok)throw new Error('Activity notification delivery failed');outcome='sent';sent++;
  }
 }catch{failed++;}
 const done=await db.rpc('finish_activity_email',{p_id:job.id,p_claim:job.claim_token,p_result:outcome});if(done.error)throw new Error('Activity notification queue update failed');
 await new Promise(resolve=>setTimeout(resolve,700));
 }return {sent,failed,cancelled};
}

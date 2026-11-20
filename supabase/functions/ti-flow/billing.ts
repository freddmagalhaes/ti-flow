import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.119.0';
import {setting} from './settings.ts';
export function billingEnvironment(){const value=setting('ASAAS_ENVIRONMENT');return value==='production'?'production':'sandbox';}
export function billingConfigured(){return !!setting('ASAAS_API_KEY')&&['sandbox','production'].includes(setting('ASAAS_ENVIRONMENT')??'')&&!!setting('ASAAS_WEBHOOK_TOKEN');}
function checked<T>(result:{data:T;error:unknown}):T{if(result.error)throw new Error('Não foi possível atualizar os dados da cobrança.');return result.data;}
export function invoiceUrl(value:unknown){if(typeof value!=='string')return null;try{const url=new URL(value);return url.protocol==='https:'&&(url.hostname==='asaas.com'||url.hostname.endsWith('.asaas.com'))?url.toString():null;}catch{return null;}}
export function paymentStatus(status:unknown):'paid'|'pending'|'overdue'|'refunded'|'disputed'|'deleted'{
 if(['CONFIRMED','RECEIVED','RECEIVED_IN_CASH'].includes(String(status)))return 'paid';
 if(status==='OVERDUE')return 'overdue';if(status==='REFUNDED')return 'refunded';if(String(status).includes('CHARGEBACK'))return 'disputed';if(status==='DELETED')return 'deleted';return 'pending';
}
export function subscriptionPayload(subscription:{id:string;method:string;amount_cents:number;months:number},customer:string,base:string,day:string){
 if(!['PIX','CREDIT_CARD'].includes(subscription.method)||![1,12].includes(subscription.months)||!Number.isInteger(subscription.amount_cents)||subscription.amount_cents<=0)throw new Error('Plano inválido.');
 return {customer,billingType:subscription.method,value:subscription.amount_cents/100,cycle:subscription.months===12?'YEARLY':'MONTHLY',nextDueDate:day,description:subscription.months===12?'TI Flow · plano anual · até 10 usuários':'TI Flow · plano mensal · até 10 usuários',externalReference:subscription.id,pixAutomaticAuthorizationMode:'DISABLED',callback:{successUrl:base+'/entrar?cobranca=retorno',autoRedirect:false}};
}
export async function asaasRequest(path:string,method='GET',body?:unknown){
 if(!billingConfigured())throw new Error('Configure as credenciais do Asaas e o ambiente antes de ativar a cobrança.');
 const root=billingEnvironment()==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3';
 const response=await fetch(root+path,{method,headers:{access_token:setting('ASAAS_API_KEY')!,'User-Agent':'TI-Flow/1.0','Content-Type':'application/json',Accept:'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`O Asaas não concluiu a solicitação (HTTP ${response.status}). Confira os dados e as credenciais do ambiente.`);return data;
}
export async function setupBilling(db:SupabaseClient,email:string){
 const environment=billingEnvironment(),existing=checked(await db.from('billing_integrations').select('*').eq('environment',environment).maybeSingle());if(existing)return {ok:true,environment};
 const webhook=await asaasRequest('/webhooks','POST',{name:'TI Flow · '+environment,url:setting('SUPABASE_URL')+'/functions/v1/ti-flow/billing/webhook?environment='+environment,email,enabled:true,interrupted:false,apiVersion:3,authToken:setting('ASAAS_WEBHOOK_TOKEN'),sendType:'SEQUENTIALLY',events:['PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','PAYMENT_REFUNDED','PAYMENT_DELETED','PAYMENT_CHARGEBACK_REQUESTED','SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED']});
 if(typeof webhook.id!=='string')throw new Error('O Asaas não retornou o identificador do webhook.');
 checked(await db.from('billing_integrations').insert({environment,webhook_id:webhook.id}));return {ok:true,environment};
}
export async function billingOverview(db:SupabaseClient,companyId:string){
 const environment=billingEnvironment(),plans=checked(await db.from('billing_plans').select('*').eq('active',true).order('months'))??[],subscriptions=checked(await db.from('billing_subscriptions').select('*').eq('company_id',companyId).eq('environment',environment).order('created_at',{ascending:false}))??[];
 const ids=subscriptions.map(s=>s.id),payments=ids.length?checked(await db.from('billing_payments').select('*').in('subscription_id',ids).eq('environment',environment).order('due_date',{ascending:false}).limit(100))??[]:[];
 const setup=checked(await db.from('billing_integrations').select('webhook_id').eq('environment',environment).maybeSingle());
 const count=await db.from('profiles').select('id',{head:true,count:'exact'}).eq('company_id',companyId).eq('active',true).neq('role','system_admin');if(count.error)throw new Error('Não foi possível consultar os usuários.');
 return {environment,configured:billingConfigured(),ready:billingConfigured()&&!!setup,plans,subscriptions,payments,active_users:count.count??0};
}
async function customerFor(db:SupabaseClient,company:Record<string,unknown>,email:string){
 const environment=billingEnvironment(),existing=checked(await db.from('billing_customers').select('provider_id').eq('company_id',company.id).eq('environment',environment).maybeSingle());if(existing)return existing.provider_id;
 const found=await asaasRequest('/customers?externalReference='+encodeURIComponent(String(company.id))+'&limit=1');let customer=found.data?.[0];
 if(!customer){const cpfCnpj=String(company.tax_id??'').replace(/\D/g,'');if(![11,14].includes(cpfCnpj.length))throw new Error('Preencha o CPF/CNPJ da empresa em Dados da empresa antes de contratar.');customer=await asaasRequest('/customers','POST',{name:company.legal_name||company.name,cpfCnpj,email:company.contact_email||email,externalReference:company.id,notificationDisabled:true});}
 if(typeof customer.id!=='string')throw new Error('Não foi possível identificar o cliente no Asaas.');checked(await db.from('billing_customers').insert({company_id:company.id,environment,provider_id:customer.id}));return customer.id;
}
async function resolveSubscription(db:SupabaseClient,sub:Record<string,any>){
 if(sub.provider_id)return sub;
 const remote=await asaasRequest('/subscriptions?externalReference='+encodeURIComponent(sub.id)+'&limit=2');if(remote.data?.length!==1)return sub;
 const provider=remote.data[0];if(Math.round(Number(provider.value)*100)!==sub.amount_cents||provider.cycle!==(sub.months===12?'YEARLY':'MONTHLY'))throw new Error('A assinatura no Asaas precisa de conferência antes de continuar.');
 return checked(await db.from('billing_subscriptions').update({provider_id:provider.id,state:'pending'}).eq('id',sub.id).select().single());
}
export async function subscribeCompany(db:SupabaseClient,company:Record<string,unknown>,actorId:string,email:string,plan:string,method:string){
 if(!['monthly','annual'].includes(plan)||!['PIX','CREDIT_CARD'].includes(method))throw new Error('Escolha um plano e uma forma de pagamento válidos.');
 const ready=checked(await db.from('billing_integrations').select('*').eq('environment',billingEnvironment()).maybeSingle());if(!billingConfigured()||!ready)throw new Error('O administrador do sistema precisa concluir a ativação do Asaas.');
 // Resolve the customer before reserving a subscription; no card data enters TI Flow.
 const customer=await customerFor(db,company,email);
 const reserved=checked(await db.rpc('reserve_company_subscription',{p_company:company.id,p_environment:billingEnvironment(),p_plan:plan,p_method:method,p_actor:actorId}));let sub=reserved.subscription;
 if(sub.plan_id!==plan||sub.method!==method)throw new Error('Já existe uma assinatura nesta empresa. Consulte ou cancele a atual antes de contratar outra.');
 if(reserved.created){try{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const provider=await asaasRequest('/subscriptions','POST',subscriptionPayload(sub,customer,setting('APP_URL')!,day));if(typeof provider.id!=='string')throw new Error('Assinatura sem identificador.');sub=checked(await db.from('billing_subscriptions').update({provider_id:provider.id,state:'pending'}).eq('id',sub.id).select().single());}catch(e){await db.from('billing_subscriptions').update({state:'uncertain'}).eq('id',sub.id).is('provider_id',null);throw e;}}
 sub=await resolveSubscription(db,sub);if(!sub.provider_id)throw new Error('A criação da assinatura aguarda conciliação. Use Atualizar para conferir antes de tentar novamente.');
 await syncPayments(db,sub);return {ok:true};
}
async function recordPayment(db:SupabaseClient,sub:Record<string,any>,payment:Record<string,any>,eventId:string,eventType:string){
 if(payment.subscription!==sub.provider_id||typeof payment.id!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate??''))throw new Error('Dados de cobrança inválidos.');
 checked(await db.rpc('record_billing_payment',{p_environment:sub.environment,p_event_id:eventId,p_event_type:eventType,p_subscription:sub.id,p_payment:payment.id,p_amount:Math.round(Number(payment.value)*100),p_due:payment.dueDate,p_status:paymentStatus(payment.status),p_url:invoiceUrl(payment.invoiceUrl)}));
}
export async function syncPayments(db:SupabaseClient,sub:Record<string,any>){
 sub=await resolveSubscription(db,sub);if(!sub.provider_id)return;const payments=await asaasRequest('/subscriptions/'+encodeURIComponent(sub.provider_id)+'/payments?limit=100');for(const p of payments.data??[])await recordPayment(db,sub,p,'sync:'+p.id+':'+p.status,'SYNC');
}
export async function cancelSubscription(db:SupabaseClient,sub:Record<string,any>){
 sub=await resolveSubscription(db,sub);if(sub.provider_id)await asaasRequest('/subscriptions/'+encodeURIComponent(sub.provider_id),'DELETE');else if(Date.now()-new Date(sub.created_at).getTime()<120000)throw new Error('Aguarde a conclusão da criação antes de cancelar.');
 checked(await db.from('billing_subscriptions').update({state:'cancelled',cancelled_at:new Date().toISOString()}).eq('id',sub.id));return {ok:true};
}
export async function billingWebhook(db:SupabaseClient,body:Record<string,any>){
 if(typeof body.id!=='string'||body.id.length>200||typeof body.event!=='string')throw new Error('Evento inválido.');
 const environment=billingEnvironment();
 if(body.event.startsWith('PAYMENT_')){
  if(typeof body.payment?.id!=='string')throw new Error('Evento sem cobrança.');const payment=await asaasRequest('/payments/'+encodeURIComponent(body.payment.id));if(!payment.subscription)return {received:true,ignored:true};
  let sub=checked(await db.from('billing_subscriptions').select('*').eq('provider_id',payment.subscription).eq('environment',environment).maybeSingle());
  if(!sub){const remote=await asaasRequest('/subscriptions/'+encodeURIComponent(payment.subscription));if(!/^[0-9a-f-]{36}$/i.test(remote.externalReference??''))return {received:true,ignored:true};sub=checked(await db.from('billing_subscriptions').select('*').eq('id',remote.externalReference).eq('environment',environment).maybeSingle());if(!sub)return {received:true,ignored:true};sub=await resolveSubscription(db,sub);}
  await recordPayment(db,sub,payment,body.id,body.event);return {received:true};
 }
 if(['SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED'].includes(body.event)&&typeof body.subscription?.id==='string'){
  const remote=body.event==='SUBSCRIPTION_DELETED'?{id:body.subscription.id,deleted:true,status:'INACTIVE'}:await asaasRequest('/subscriptions/'+encodeURIComponent(body.subscription.id));if(remote.deleted||remote.status==='INACTIVE')checked(await db.from('billing_subscriptions').update({state:'cancelled',cancelled_at:new Date().toISOString()}).eq('provider_id',remote.id).eq('environment',environment));
 }
 return {received:true};
}

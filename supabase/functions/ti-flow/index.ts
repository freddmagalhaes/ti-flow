import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {validPassword,temporaryPassword,sha256,secureToken,encryptPayload,decryptPayload} from './policy.ts';
import {mailReady,emailContent,sendEmail} from './mail.ts';
import {setting,configureRuntime} from './settings.ts';
import {isSystemAdmin,canAdminCompany,canAdminAccount,canAssignRole,validCompany} from './permissions.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const serverKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const publicKey=Deno.env.get('SUPABASE_ANON_KEY')!;
const admin=createClient(url,serverKey,{auth:{persistSession:false,autoRefreshToken:false}});
const runtimeNames=['APP_URL','ALLOWED_ORIGIN','MAIL_FROM','MAIL_ENCRYPTION_KEY','EMAIL_WORKER_SECRET','BOOTSTRAP_SECRET','EMAIL_DELIVERY_ENABLED'];
async function loadRuntimeConfig(){
 const {data,error}=await admin.rpc('ti_flow_runtime_config');
 if(error||!data)throw new HttpError(503,'O ambiente está em configuração. Tente novamente em instantes.');
 configureRuntime(Object.fromEntries(Object.entries(data as Record<string,string>).filter(([name,value])=>runtimeNames.includes(name)&&typeof value==='string')));
}
const encryptionKey=()=>setting('MAIL_ENCRYPTION_KEY')!;
const client=()=>createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
function check<T extends {data:unknown;error:unknown}>(value:T):T['data'] {if(value.error)throw new HttpError(400,'Não foi possível concluir a operação. Verifique os dados e tente novamente.');return value.data;}
function assert(condition:unknown,message:string,status=400):asserts condition {if(!condition)throw new HttpError(status,message);}
type Profile={id:string;company_id:string;full_name:string;username:string;role:string;active:boolean;must_change_password:boolean;password_expires_at:string|null;welcome_status:string;password_status:string};
async function profileFor(id:string):Promise<Profile> {const {data}=await admin.from('profiles').select('*').eq('id',id).maybeSingle();assert(data,'Usuário não autorizado.',403);return data;}
async function companyFor(id:string){const {data,error}=await admin.from('companies').select('*').eq('id',id).maybeSingle();assert(!error&&data,'Empresa indisponível.',403);return data;}
async function accountEnabled(profile:Profile){return profile.active&&(isSystemAdmin(profile)||(await companyFor(profile.company_id)).active);}
async function actor(request:Request,allowPassword=false):Promise<{profile:Profile;token:string}> {const token=request.headers.get('Authorization')?.replace(/^Bearer /i,'');assert(token,'Sua sessão expirou. Entre novamente.',401);const {data,error}=await admin.auth.getUser(token);assert(!error&&data.user,'Sua sessão expirou. Entre novamente.',401);const scoped=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});const {data:valid,error:sessionError}=await scoped.rpc('session_valid');assert(!sessionError&&valid,'Sua sessão expirou. Entre novamente.',401);const profile=await profileFor(data.user.id);assert(await accountEnabled(profile),'Seu acesso ou sua empresa foi desativada.',403);assert(allowPassword||!profile.must_change_password,'Altere sua senha antes de continuar.',403);return {profile,token};}
async function authLimit(request:Request,name:string,action:string,limit=10) {const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown';const key=await sha256(`${action}:${ip}:${name.toLowerCase()}`);const allowed=check(await admin.rpc('consume_auth_attempt',{p_key:key,p_limit:limit}));assert(allowed,'Muitas tentativas. Aguarde 15 minutos e tente novamente.',429);const global=check(await admin.rpc('consume_auth_attempt',{p_key:await sha256(`${action}:ip:${ip}`),p_limit:60}));assert(global,'Muitas tentativas. Aguarde 15 minutos e tente novamente.',429);}
async function findByUsername(username:string):Promise<Profile|null> {if(!/^[a-z]+\.[a-z]+$/.test(username))return null;const {data}=await admin.from('profiles').select('*').eq('username',username).maybeSingle();return data;}
async function getEmail(id:string) {const {data,error}=await admin.auth.admin.getUserById(id);assert(!error&&data.user?.email,'Cadastro de e-mail indisponível.');return data.user.email;}
async function revokeAllWithNewPassword(email:string,password:string) {const auth=client();const {data,error}=await auth.auth.signInWithPassword({email,password});assert(!error&&data.session,'Não foi possível renovar o acesso. Tente entrar novamente.',503);const result=await admin.auth.admin.signOut(data.session.access_token,'global');assert(!result.error,'Não foi possível encerrar as sessões anteriores.',503);}
async function resetTemporary(profile:Profile) {assert(mailReady(),'Configure e valide o serviço de e-mail antes de cadastrar ou reenviar senhas.',503);const email=await getEmail(profile.id),password=temporaryPassword();check(await admin.from('profiles').update({must_change_password:true,password_expires_at:null,password_status:'programado'}).eq('id',profile.id));check(await admin.from('email_jobs').update({state:'cancelled',encrypted_payload:null}).eq('user_id',profile.id).in('state',['scheduled','sending','blocked','failed']).eq('kind','password'));check(await admin.auth.admin.updateUserById(profile.id,{password}));await revokeAllWithNewPassword(email,password);const firstWelcome=profile.welcome_status!=='enviado';if(firstWelcome){check(await admin.from('email_jobs').update({state:'scheduled',send_at:new Date().toISOString(),attempts:0}).eq('user_id',profile.id).eq('kind','welcome').in('state',['failed','scheduled','sending','cancelled']));check(await admin.from('profiles').update({welcome_status:'aguardando'}).eq('id',profile.id));}check(await admin.from('email_jobs').insert({user_id:profile.id,kind:'password',recipient:email,encrypted_payload:await encryptPayload({password},encryptionKey()),state:firstWelcome?'blocked':'scheduled',send_at:firstWelcome?null:new Date().toISOString()}));}
async function createAccount(body:Record<string,unknown>) {
 assert(mailReady(),'Configure e valide o serviço de e-mail antes de cadastrar usuários.',503);
 const name=String(body.full_name??'').trim(),username=String(body.username??'').trim().toLowerCase(),email=String(body.email??'').trim();
 assert(name.length>=2&&name.length<=160&&/^[a-z]+\.[a-z]+$/.test(username)&&username.length<=100&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254&&['system_admin','admin','manager','technician'].includes(String(body.role)),'Verifique nome, login, e-mail e perfil.');
 assert(!await findByUsername(username),'Este login já está em uso.');
 const companyId=String(body.company_id??'');const company=await companyFor(companyId);assert(company.active,'Ative a empresa antes de cadastrar usuários.');
 const password=temporaryPassword(),encrypted=await encryptPayload({password},encryptionKey());
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});
 assert(!error&&data.user,'Não foi possível criar a conta. Verifique se o e-mail já está cadastrado.');
 const record=await admin.rpc('create_company_account_records',{p_user_id:data.user.id,p_name:name,p_username:username,p_role:body.role,p_email:email,p_encrypted:encrypted,p_company:companyId});
 if(record.error){await admin.auth.admin.deleteUser(data.user.id);throw new HttpError(400,'Não foi possível concluir o cadastro. Verifique se o login já está em uso.');}
 return {ok:true,id:data.user.id};
}
async function processEmails() {assert(mailReady(),'Email delivery is not enabled.',503);const jobs=(check(await admin.rpc('claim_email_jobs'))??[]) as {id:string;user_id:string;kind:string;recipient:string;encrypted_payload:string|null;claim_token:string}[];let sent=0,failed=0;await Promise.all(jobs.map(async(job)=>{let success=false;try{const p=await profileFor(job.user_id);if(!await accountEnabled(p)){await admin.from('email_jobs').update({state:'cancelled',encrypted_payload:null}).eq('id',job.id).eq('claim_token',job.claim_token);return;}const payload=job.encrypted_payload?await decryptPayload<{password?:string;token?:string}>(job.encrypted_payload,encryptionKey()):{};await sendEmail(job.id,job.recipient,emailContent(job.kind,p,payload));success=true;sent++;}catch{failed++;/* Never log credentials, bodies, SMTP responses or recipient addresses. */}check(await admin.rpc('finish_email_job',{p_id:job.id,p_claim:job.claim_token,p_success:success}));}));
 await admin.from('email_jobs').update({encrypted_payload:null,state:'failed'}).lt('created_at',new Date(Date.now()-24*60*60*1000).toISOString()).in('state',['blocked','failed']);
 await admin.from('password_resets').delete().lt('expires_at',new Date().toISOString());await admin.from('auth_attempts').delete().lt('window_start',new Date(Date.now()-86400000).toISOString());return {sent,failed};}

Deno.serve(async request=>{
 let allowedOrigin=setting('ALLOWED_ORIGIN')??setting('APP_URL')??'https://ti-flow-automacoes.meshedkayak2.chatgpt.site';
 const origin=request.headers.get('Origin');
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-worker-secret'};
 const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 try{
  await loadRuntimeConfig();
  allowedOrigin=setting('ALLOWED_ORIGIN')??allowedOrigin;
  if(origin===allowedOrigin)headers['Access-Control-Allow-Origin']=origin;
  if(request.method==='OPTIONS')return new Response(null,{status:origin===allowedOrigin?204:403,headers});
  assert(request.method==='POST','Método não permitido.',405);
  if(origin)assert(origin===allowedOrigin,'Origem não autorizada.',403);
  const action=new URL(request.url).pathname.split('/ti-flow/')[1]??'';
  if(action==='health')return respond({smtp_ready:mailReady(),connected:true});
  if(action==='worker/send-emails'){const supplied=request.headers.get('X-Worker-Secret'),expected=setting('EMAIL_WORKER_SECRET');assert(expected&&supplied&&await sha256(supplied)===await sha256(expected),'Não autorizado.',401);return respond(mailReady()?await processEmails():{sent:0,pending_configuration:true});}
  const raw=await request.text();assert(raw.length<25000,'Solicitação muito grande.',413);const body=JSON.parse(raw||'{}');
  if(action==='auth/login'){
   const username=String(body.username??'').trim().toLowerCase();await authLimit(request,username,'login');const profile=await findByUsername(username);
   const invalid='Usuário ou senha inválidos.';assert(profile&&await accountEnabled(profile),invalid,401);
   const email=await getEmail(profile.id);const auth=client();const {data,error}=await auth.auth.signInWithPassword({email,password:String(body.password??'')});assert(!error&&data.session,invalid,401);
   if(profile.must_change_password&&(!profile.password_expires_at||new Date(profile.password_expires_at)<new Date())){await auth.auth.signOut();throw new HttpError(403,'A senha temporária expirou ou ainda não foi enviada. Solicite o reenvio ao administrador.');}
   return respond({session:{access_token:data.session.access_token,refresh_token:data.session.refresh_token},profile});
  }
  if(action==='auth/recover'){
   const username=String(body.username??'').trim().toLowerCase();await authLimit(request,username,'recover',3);const profile=await findByUsername(username);
   if(profile&&await accountEnabled(profile)&&mailReady()){const token=secureToken(),email=await getEmail(profile.id);check(await admin.from('password_resets').insert({token_hash:await sha256(token),user_id:profile.id,expires_at:new Date(Date.now()+30*60000).toISOString()}));check(await admin.from('email_jobs').insert({user_id:profile.id,kind:'recovery',recipient:email,state:'scheduled',send_at:new Date().toISOString(),encrypted_payload:await encryptPayload({token},encryptionKey())}));}
   return respond({ok:true});
  }
  if(action==='auth/reset'){
   await authLimit(request,'reset','reset',10);assert(validPassword(body.password),'Use de 8 a 12 caracteres, contendo letras e números, sem símbolos ou espaços.');const hash=await sha256(String(body.token??''));const reset=check(await admin.from('password_resets').update({used_at:new Date().toISOString()}).eq('token_hash',hash).is('used_at',null).gt('expires_at',new Date().toISOString()).select().maybeSingle());assert(reset,'O link expirou ou já foi utilizado. Solicite outra recuperação.');const profile=await profileFor(reset.user_id);assert(await accountEnabled(profile),'Acesso desativado.',403);const email=await getEmail(profile.id);check(await admin.auth.admin.updateUserById(profile.id,{password:body.password}));await revokeAllWithNewPassword(email,body.password);check(await admin.from('profiles').update({must_change_password:false,password_expires_at:null}).eq('id',profile.id));return respond({ok:true});
  }
  if(action==='admin/bootstrap'){
   const expected=setting('BOOTSTRAP_SECRET'),supplied=request.headers.get('X-Bootstrap-Secret');
   assert(expected&&supplied&&await sha256(supplied)===await sha256(expected),'Não autorizado.',401);
   const count=await admin.from('profiles').select('id',{count:'exact',head:true});
   assert(!count.error&&count.count===0,'O primeiro administrador já foi provisionado.',409);
   const company=check(await admin.from('companies').select('id').eq('slug','automacoes-ti').single());
   assert(company,'Empresa inicial indisponível.',503);
   return respond(await createAccount({...body,role:'system_admin',company_id:company.id}));
  }
  const {profile}=await actor(request,action==='auth/password');
  if(action==='auth/password'){
   assert(validPassword(body.password),'Use de 8 a 12 caracteres, contendo letras e números, sem símbolos ou espaços.');assert(body.password!==body.old_password,'A nova senha deve ser diferente da atual.');
   if(profile.must_change_password)assert(profile.password_expires_at&&new Date(profile.password_expires_at)>=new Date(),'A senha temporária expirou. Solicite o reenvio ao administrador.',403);
   const email=await getEmail(profile.id),auth=client();const verified=await auth.auth.signInWithPassword({email,password:String(body.old_password??'')});assert(!verified.error,'A senha atual não confere.',401);check(await admin.auth.admin.updateUserById(profile.id,{password:body.password}));await revokeAllWithNewPassword(email,body.password);check(await admin.from('profiles').update({must_change_password:false,password_expires_at:null}).eq('id',profile.id));return respond({ok:true});
  }
  if(action.startsWith('system/')){
   assert(isSystemAdmin(profile),'Acesso exclusivo do administrador do sistema.',403);
   if(action==='system/create-company'){
    assert(mailReady(),'Configure o envio de e-mail antes de cadastrar empresas.',503);
    const name=String(body.name??'').trim(),slug=String(body.slug??'').trim().toLowerCase();
    assert(validCompany(name,slug),'Informe um nome e um identificador válido para a empresa.');
    const owner=body.administrator;assert(owner&&typeof owner==='object'&&!Array.isArray(owner),'Informe o administrador da empresa.');
    const created=await admin.from('companies').insert({name,slug}).select('*').single();
    assert(!created.error&&created.data,'Não foi possível criar a empresa. Verifique se o identificador já está em uso.');
    try{const account=await createAccount({...owner,company_id:created.data.id,role:'admin'});return respond({company:created.data,administrator_id:account.id});}
    catch(error){await admin.from('companies').delete().eq('id',created.data.id);throw error;}
   }
   if(action==='system/update-company'){
    const name=String(body.name??'').trim();assert(name.length>=2&&name.length<=160&&typeof body.active==='boolean','Verifique o nome e a situação da empresa.');
    const target=await companyFor(String(body.id??''));const updated=check(await admin.from('companies').update({name,active:body.active}).eq('id',target.id).select().single());
    return respond({company:updated});
   }
   throw new HttpError(404,'Operação não encontrada.');
  }
  assert(profile.role==='admin'||isSystemAdmin(profile),'Acesso exclusivo do administrador.',403);
  const companyId=String(body.company_id??profile.company_id);
  assert(canAdminCompany(profile,companyId),'Você não pode administrar outra empresa.',403);
  if(action==='admin/list-users'){
   await companyFor(companyId);const profiles=check(await admin.from('profiles').select('*').eq('company_id',companyId).order('full_name'))??[];
   const users=[];for(const p of profiles)users.push({...p,email:await getEmail(p.id)});return respond({profiles:users});
  }
  if(action==='admin/create-user'){
   assert(canAssignRole(profile,body.role),'Você não pode atribuir esse perfil.',403);
   return respond(await createAccount({...body,company_id:companyId}));
  }
  if(['admin/set-active','admin/set-role','admin/resend'].includes(action)){
   const target=await profileFor(String(body.id??''));
   assert(canAdminAccount(profile,target)&&target.company_id===companyId,'Usuário indisponível ou sem permissão.',403);
   if(action==='admin/set-active'){
    assert(body.id!==profile.id,'Você não pode desativar sua própria conta.');assert(typeof body.active==='boolean','Situação inválida.');
    check(await admin.from('profiles').update({active:body.active}).eq('id',target.id));
    if(!body.active)check(await admin.from('email_jobs').update({state:'cancelled',encrypted_payload:null}).eq('user_id',target.id).in('state',['scheduled','sending','blocked']));
    return respond({ok:true});
   }
   if(action==='admin/set-role'){
    assert(canAssignRole(profile,body.role),'Perfil inválido ou sem permissão.',403);assert(body.id!==profile.id,'Solicite a outro administrador a alteração do seu próprio perfil.');
    check(await admin.from('profiles').update({role:body.role}).eq('id',target.id));return respond({ok:true});
   }
   assert(await accountEnabled(target),'Ative o usuário e a empresa antes de reenviar.');await resetTemporary(target);return respond({ok:true});
  }
  throw new HttpError(404,'Operação não encontrada.');
 }catch(error){if(error instanceof HttpError)return respond({error:error.message},error.status);return respond({error:'Não foi possível concluir a solicitação. Tente novamente.'},500);}
});

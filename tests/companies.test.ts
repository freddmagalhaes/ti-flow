import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {canAdminCompany,canAdminAccount,canAssignRole,validCompany} from '../supabase/functions/ti-flow/permissions';
let db:PGlite,companyA:string,companyB:string,legacyCard:string;
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const system=id(1),adminA=id(2),adminB=id(3),techA=id(4),techB=id(5),managerA=id(6),pendingA=id(7);
const session=(user:string)=>'a'+user.slice(1);
async function root(){await db.exec('reset role');}
async function as(user:string){await root();await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role:'authenticated',session_id:session(user)})]);await db.exec('set role authenticated');}
async function user(userId:string,name:string,role:string,company?:string,force=false){
 await root();await db.query('insert into auth.users(id,email) values($1,$2)',[userId,name+'@example.invalid']);await db.query('insert into auth.sessions values($1,$2)',[session(userId),userId]);
 if(company)await db.query('insert into profiles(id,full_name,username,role,company_id,must_change_password) values($1,$2,$3,$4,$5,$6)',[userId,name,name.toLowerCase()+'.user',role,company,force]);
 else await db.query('insert into profiles(id,full_name,username,role,must_change_password) values($1,$2,$3,$4,false)',[userId,name,name==='Frederico'?'frederico.magalhaes':name.toLowerCase()+'.user',role]);
}
async function card(owner:string,company:string,title='Atividade de teste'){
 const result=await db.query<{id:string;version:number}>('insert into activities(company_id,title,assignee_id,created_by,start_date,due_date) values($1,$2,$3,auth.uid(),current_date,current_date) returning id,version',[company,title,owner]);return result.rows[0];
}
async function rejected(sql:string,params:unknown[]=[],pattern?:RegExp){await db.exec('savepoint denied');let error:unknown;try{await db.query(sql,params);}catch(value){error=value;}await db.exec('rollback to savepoint denied;release savepoint denied');expect(error).toBeTruthy();if(pattern)expect(String(error)).toMatch(pattern);}
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_change text default '',encrypted_password text);create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 create function storage.extension(text) returns text language sql immutable as $$select reverse(split_part(reverse($1),'.',1))$$;
 grant usage on schema storage to authenticated,service_role;grant select,insert on storage.objects to authenticated;grant all on storage.objects to service_role;
 create publication supabase_realtime;`);
 await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/storage-and-realtime.sql',import.meta.url),'utf8'));
 await user(system,'Frederico','admin');await db.query('update auth.users set email=$1 where id=$2',['frederico.magalhaes@outlook.com',system]);
 await user(techA,'Tecnicoa','technician');await as(system);
 legacyCard=(await db.query<{id:string}>("insert into activities(title,assignee_id,created_by,start_date,due_date) values('Registro preservado',$1,$2,current_date,current_date) returning id",[techA,system])).rows[0].id;
 await db.query('select complete_activity($1,1)',[legacyCard]);await root();
 await db.exec(await readFile(new URL('../supabase/multi-company.sql',import.meta.url),'utf8'));
 companyA=(await db.query<{id:string}>("select id from companies where slug='automacoes-ti'")).rows[0].id;
 companyB=(await db.query<{id:string}>("insert into companies(name,slug) values('Empresa B','empresa-b') returning id")).rows[0].id;
 await user(adminA,'Admina','admin',companyA);await user(adminB,'Adminb','admin',companyB);await user(techB,'Tecnicob','technician',companyB);await user(managerA,'Gestora','manager',companyA);await user(pendingA,'Pendentea','technician',companyA,true);
 await db.exec(await readFile(new URL('../supabase/migrations/20261120114748_scope_usernames_by_environment.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261120165243_expand_workspace_profiles_and_statuses.sql',import.meta.url),'utf8'));
 await db.exec("create schema vault;create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,decrypted_secret text);create view vault.decrypted_secrets as select name,decrypted_secret from vault.secrets;create schema extensions;create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat('00',n),'hex')$$;create function vault.create_secret(value text,label text,description text) returns uuid language sql as $$insert into vault.secrets(name,decrypted_secret) values(label,value) returning id$$;");
 await db.exec(await readFile(new URL('../supabase/migrations/20261120170126_add_public_contact_messages.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261120170531_add_company_billing.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261123125328_allow_unfinished_activity_deletion.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261123132026_activity_email_notifications.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{await root();await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback;reset role');});
afterAll(async()=>{await db?.close();});

describe('Activity notification queue',()=>{
 it('notifies creation and reassignment once and cancels the old recipient',async()=>{
  await as(adminA);const c=await card(techA,companyA);await db.query("update activities set title='Nova descrição do título' where id=$1",[c.id]);
  await root();expect((await db.query('select id from activity_email_jobs')).rows).toHaveLength(1);
  await as(adminA);await db.query('update activities set assignee_id=$1 where id=$2',[adminA,c.id]);await root();
  expect((await db.query<{state:string;recipient_id:string}>("select state,recipient_id from activity_email_jobs order by recipient_id")).rows).toEqual(expect.arrayContaining([{state:'cancelled',recipient_id:techA},{state:'scheduled',recipient_id:adminA}]));
  expect((await db.query("select has_table_privilege('authenticated','activity_email_jobs','select') as allowed")).rows[0]).toMatchObject({allowed:false});
 });
 it('schedules Friday warnings for Monday deadlines, respects business hours and prevents duplicate reminders',async()=>{
  await as(adminA);const c=await card(techA,companyA);await db.query("update activities set due_date='2026-11-30' where id=$1",[c.id]);await root();
  await db.query("select private.schedule_activity_emails('2026-11-27 11:00:00+00')");expect((await db.query("select * from activity_email_jobs where kind='due_soon'")).rows).toHaveLength(0);
  await db.query("select private.schedule_activity_emails('2026-11-27 12:00:00+00')");await db.query("select private.schedule_activity_emails('2026-11-27 13:00:00+00')");
  expect((await db.query("select * from activity_email_jobs where kind='due_soon'")).rows).toHaveLength(1);
  await db.query("select private.schedule_activity_emails('2026-12-01 12:00:00+00')");expect((await db.query("select * from activity_email_jobs where kind='overdue'")).rows).toHaveLength(1);
 });
 it('groups late activities into one daily summary per responsible person and company',async()=>{
  await as(adminA);const a=await card(techA,companyA),b=await card(techA,companyA);await db.query("update activities set due_date='2026-11-30' where id=any($1)",[[a.id,b.id]]);await root();
  await db.query("select private.schedule_activity_emails('2026-12-02 12:00:00+00')");await db.query("select private.schedule_activity_emails('2026-12-02 14:00:00+00')");
  const jobs=(await db.query<{items:unknown[]}>("select items from activity_email_jobs where kind='overdue_digest'")).rows;expect(jobs).toHaveLength(1);expect(jobs[0].items).toHaveLength(2);
 });
 it('reschedules changed deadlines without reusing the old reminder and respects opted-out recipients',async()=>{
  await as(adminA);const c=await card(techA,companyA);await db.query("update activities set due_date='2026-11-30' where id=$1",[c.id]);await root();await db.query("select private.schedule_activity_emails('2026-11-27 12:00:00+00')");
  await as(adminA);await db.query("update activities set due_date='2026-12-01' where id=$1",[c.id]);await root();await db.query("select private.schedule_activity_emails('2026-11-30 12:00:00+00')");
  expect((await db.query("select * from activity_email_jobs where kind='due_soon'")).rows).toHaveLength(2);
  await db.query('update profiles set activity_emails_enabled=false where id=$1',[techA]);await as(adminA);await card(techA,companyA);await root();
  expect((await db.query("select * from activity_email_jobs where kind='assigned'")).rows).toHaveLength(1);
 });
 it('leases jobs once and rejects stale completion tokens and public queue access',async()=>{
  await as(adminA);await card(techA,companyA);await root();const jobs=(await db.query<{id:string;claim_token:string}>('select * from claim_activity_emails()')).rows;expect(jobs).toHaveLength(1);
  expect((await db.query('select * from claim_activity_emails()')).rows).toHaveLength(0);
  await db.query("select finish_activity_email($1,gen_random_uuid(),'sent')",[jobs[0].id]);expect((await db.query('select state from activity_email_jobs where id=$1',[jobs[0].id])).rows[0]).toMatchObject({state:'sending'});
  for(const role of ['anon','authenticated'])expect((await db.query("select has_function_privilege($1,'public.claim_activity_emails()','execute') as allowed",[role])).rows[0]).toMatchObject({allowed:false});
 });
 it('cancels pending notices after completion or reassignment and keeps foreign recipients out',async()=>{
  await as(adminA);const c=await card(techA,companyA);await root();const j=(await db.query<{id:string;claim_token:string}>('select * from claim_activity_emails()')).rows[0];await as(adminA);await db.query('select complete_activity($1,1)',[c.id]);await root();
  expect((await db.query<{context:{cards:unknown[]|null}}>('select activity_email_context($1,$2) as context',[j.id,j.claim_token])).rows[0].context.cards).toBeNull();
  await as(adminA);const other=await card(techA,companyA);await root();const k=(await db.query<{id:string;claim_token:string}>('select * from claim_activity_emails()')).rows[0];await as(adminA);await db.query('update activities set assignee_id=$1 where id=$2',[adminA,other.id]);await root();
  expect((await db.query('select activity_email_context($1,$2) as context',[k.id,k.claim_token])).rows[0]).toMatchObject({context:null});
 });
 it('revalidates completed, deleted, reassigned and opted-out cards before delivery',async()=>{
  await as(adminA);const c=await card(techA,companyA);await root();const job=(await db.query<{id:string;claim_token:string}>('select * from claim_activity_emails()')).rows.find(j=>!!j.claim_token)!;
  expect((await db.query<{context:{cards:unknown[]}}>('select activity_email_context($1,$2) as context',[job.id,job.claim_token])).rows[0].context.cards).toHaveLength(1);
  await as(adminA);await db.query('select delete_activity($1,1)',[c.id]);await root();expect((await db.query<{context:{cards:unknown[]|null}}>('select activity_email_context($1,$2) as context',[job.id,job.claim_token])).rows[0].context.cards).toBeNull();
  await db.query('update profiles set activity_emails_enabled=false where id=$1',[techA]);expect((await db.query('select activity_email_context($1,$2) as context',[job.id,job.claim_token])).rows[0]).toMatchObject({context:null});
  await rejected('select finish_activity_email($1,$2,$3)',[job.id,job.claim_token,'unsafe']);
 });
});

describe('Deletion of unfinished activities',()=>{
 it.each(['pending','in_progress','third_party','testing'])('removes %s from work queries while preserving its audit and identity',async status=>{
  await as(adminA);const c=await card(techA,companyA);const updated=(await db.query<{version:number}>('update activities set status=$1 where id=$2 returning version',[status,c.id])).rows[0];
  await db.query('select delete_activity($1,$2)',[c.id,updated.version]);
  expect((await db.query('select id from activities where id=$1 and deleted_at is null',[c.id])).rows).toHaveLength(0);
  expect((await db.query<{deleted_by:string;version:number}>('select deleted_by,version from activities where id=$1',[c.id])).rows[0]).toMatchObject({deleted_by:adminA,version:updated.version+1});
  expect((await db.query<{action:string}>('select action from audit_events where activity_id=$1',[c.id])).rows.map(x=>x.action)).toContain('Atividade excluída');
  await rejected('update activities set deleted_at=null,deleted_by=null where id=$1',[c.id],/excluída/);
 });
 it('rejects completed cards, stale versions, strangers and technicians deleting work of another person',async()=>{
  await as(adminA);const c=await card(techA,companyA);await rejected('select delete_activity($1,999)',[c.id]);
  await as(techB);await rejected('select delete_activity($1,1)',[c.id]);
  await as(pendingA);await rejected('select delete_activity($1,1)',[c.id]);
  await as(adminA);const other=await card(adminA,companyA);await as(techA);await rejected('select delete_activity($1,1)',[other.id]);
  await db.query('select delete_activity($1,1)',[c.id]);
  await as(adminA);await db.query('select complete_activity($1,1)',[other.id]);await rejected('select delete_activity($1,2)',[other.id]);
 });
 it('lets system administrators act across companies and managers act only inside their company',async()=>{
  await as(adminB);const b=await card(techB,companyB);await as(managerA);await rejected('select delete_activity($1,1)',[b.id]);
  const a=await card(techA,companyA);await db.query('select delete_activity($1,1)',[a.id]);await as(system);await db.query('select delete_activity($1,1)',[b.id]);
 });
 it('preserves reopening links and permits a new continuation after an accidental open card is deleted',async()=>{
  await as(adminA);const source=await card(techA,companyA);await db.query('select complete_activity($1,1)',[source.id]);
  const opened=(await db.query<{id:string;parent_id:string;root_id:string}>("select * from reopen_activity($1,'Aberto por engano',current_date,current_date,$2)",[source.id,techA])).rows[0];
  await db.query('select delete_activity($1,1)',[opened.id]);
  const replacement=(await db.query<{id:string;parent_id:string;root_id:string}>("select * from reopen_activity($1,'Retomada correta',current_date,current_date,$2)",[source.id,techA])).rows[0];
  expect(replacement.id).not.toBe(opened.id);expect(replacement.parent_id).toBe(source.id);expect(replacement.root_id).toBe(source.id);
  expect((await db.query<{parent_id:string}>('select parent_id from activities where id=$1',[opened.id])).rows[0].parent_id).toBe(source.id);
 });
});

describe('Companies: migration, RLS, files and lifecycle',()=>{
 it('preserves archived records and promotes the existing owner to system administrator',async()=>{
  expect((await db.query<{role:string}>('select role from profiles where id=$1',[system])).rows[0].role).toBe('system_admin');
  const c=(await db.query<{title:string;status:string;version:number;company_id:string}>('select * from activities where id=$1',[legacyCard])).rows[0];
  expect(c).toMatchObject({title:'Registro preservado',status:'completed',version:2,company_id:companyA});expect((await db.query('select * from audit_events where activity_id=$1',[legacyCard])).rows).toHaveLength(2);
 });
 it('hides companies, people, cards and audit history from other companies',async()=>{
  await as(adminB);const foreign=await card(techB,companyB,'Somente B');await as(adminA);
  expect((await db.query('select * from companies')).rows).toHaveLength(1);
  expect((await db.query('select * from profiles where company_id=$1',[companyB])).rows).toHaveLength(0);
  expect((await db.query('select * from activities where id=$1',[foreign.id])).rows).toHaveLength(0);
  expect((await db.query('select * from audit_events where activity_id=$1',[foreign.id])).rows).toHaveLength(0);
  expect((await db.query("update activities set title='Tentativa' where id=$1 returning id",[foreign.id])).rows).toHaveLength(0);
 });
 it('blocks foreign inserts, assignment and company changes even with known IDs',async()=>{
  await as(adminA);await rejected('insert into activities(company_id,title,assignee_id,created_by,start_date,due_date) values($1,$2,$3,$4,current_date,current_date)',[companyB,'Invasão',techB,adminA]);
  const own=await card(techA,companyA);await rejected('update activities set assignee_id=$1 where id=$2',[techB,own.id],/empresa|responsável/);
  await rejected('update activities set company_id=$1 where id=$2',[companyB,own.id],/empresa/);
  await rejected("update profiles set role='system_admin' where id=$1",[adminA]);
 });
 it('keeps technician and manager rules inside the company',async()=>{
  await as(adminA);const own=await card(techA,companyA);const second=await card(managerA,companyA);await as(techA);
  expect((await db.query('select * from activities where id=$1',[second.id])).rows).toHaveLength(1);
  expect((await db.query("update activities set title='Sem permissão' where id=$1 returning id",[second.id])).rows).toHaveLength(0);
  expect((await db.query("update activities set title='Minha tarefa' where id=$1 returning id",[own.id])).rows).toHaveLength(1);
  await as(managerA);expect((await db.query("update activities set priority='urgent' where id=$1 returning id",[own.id])).rows).toHaveLength(1);
 });
 it('allows the system administrator to manage all companies and keeps assignments within each company',async()=>{
  await as(system);expect((await db.query('select * from companies')).rows).toHaveLength(2);
  const b=await card(techB,companyB);expect((await db.query('select * from activities where id=$1',[b.id])).rows).toHaveLength(1);
  await rejected('update activities set assignee_id=$1 where id=$2',[techA,b.id],/empresa/);
 });
 it('blocks data and reopening until the initial password has changed',async()=>{
  await as(pendingA);expect((await db.query('select * from activities')).rows).toHaveLength(0);await rejected('select * from reopen_activity($1,$2,current_date,current_date,$3)',[legacyCard,'Retomar',pendingA],/autorizado/);
 });
 it('rejects reopening foreign cards and preserves company identity in valid copies',async()=>{
  await as(adminA);await rejected('select * from reopen_activity($1,$2,current_date,current_date,$3)',[legacyCard,'Transferir',techB],/empresa/);
  const copy=(await db.query<{id:string;company_id:string;parent_id:string}>('select * from reopen_activity($1,$2,current_date,current_date,$3)',[legacyCard,'Retomar',techA])).rows[0];expect(copy.company_id).toBe(companyA);expect(copy.parent_id).toBe(legacyCard);
  await as(adminB);await rejected('select * from reopen_activity($1,$2,current_date,current_date,$3)',[legacyCard,'Outra empresa',techB],/permissão/);
 });
 it('isolates private file reads and uploads by the original activity',async()=>{
  await as(adminB);const foreign=await card(techB,companyB);await db.query("insert into storage.objects(bucket_id,name) values('attachments',$1)",[foreign.id+'/private.pdf']);
  await as(adminA);expect((await db.query("select * from storage.objects where bucket_id='attachments'")).rows).toHaveLength(0);
  await rejected("insert into storage.objects(bucket_id,name) values('attachments',$1)",[foreign.id+'/invasion.pdf']);
  const own=await card(techA,companyA);await db.query("insert into storage.objects(bucket_id,name) values('attachments',$1)",[own.id+'/manual.pdf']);
  expect((await db.query("select * from storage.objects where bucket_id='attachments'")).rows).toHaveLength(1);
  await as(system);expect((await db.query("select * from storage.objects where bucket_id='attachments'")).rows).toHaveLength(2);
 });
 it('prevents attaching foreign evidence and retains same-company evidence after reopening',async()=>{
  await as(adminB);const foreign=await card(techB,companyB);await as(adminA);const own=await card(techA,companyA);
  await rejected('update activities set attachments=$1 where id=$2',[JSON.stringify([{id:'foreign',path:foreign.id+'/file.pdf'}]),own.id],/empresa/);
  const attachments=[{id:'file',path:own.id+'/manual.pdf',name:'manual.pdf'}];await db.query('update activities set attachments=$1 where id=$2',[JSON.stringify(attachments),own.id]);await db.query('select complete_activity($1,2)',[own.id]);
  const copy=(await db.query<{attachments:unknown[]}>('select * from reopen_activity($1,$2,current_date,current_date,$3)',[own.id,'Continuação',techA])).rows[0];expect(copy.attachments).toEqual(attachments);
 });
 it('revokes company access immediately when suspended, while preserving system management',async()=>{
  await as(adminB);const b=await card(techB,companyB);await root();await db.query('update companies set active=false where id=$1',[companyB]);await as(adminB);
  expect((await db.query('select * from activities where id=$1',[b.id])).rows).toHaveLength(0);expect((await db.query('select * from profiles where id=$1',[techB])).rows).toHaveLength(0);
  await as(system);expect((await db.query('select * from activities where id=$1',[b.id])).rows).toHaveLength(1);
 });
 it('protects the last company administrator separately from the system administrator',async()=>{
  await root();await rejected('update profiles set active=false where id=$1',[adminA],/último administrador da empresa/);await rejected('update profiles set active=false where id=$1',[system],/último administrador do sistema/);
  await rejected('update profiles set company_id=$1 where id=$2',[companyB,techA],/empresa/);
 });
 it('restricts company provisioning and queued credentials to the trusted server',async()=>{
  await as(adminA);await rejected("insert into companies(name,slug) values('Invasão','invasao')");await rejected("update companies set active=false where id=$1",[companyA]);
  await rejected('select create_company_account_records($1,$2,$3,$4,$5,$6,$7)',[id(90),'Intruso','intruso.user','system_admin','intruso@example.invalid','encrypted',companyA]);await rejected('select * from email_jobs');
 });
 it('provisions a company administrator with the same forced password change and two email jobs',async()=>{
  await root();await db.query('insert into auth.users(id,email) values($1,$2)',[id(90),'novo@example.invalid']);await db.exec('set role service_role');
  await db.query('select create_company_account_records($1,$2,$3,$4,$5,$6,$7)',[id(90),'Novo Admin','novo.admin','admin','novo@example.invalid','encrypted-only',companyB]);
  const profile=(await db.query<{company_id:string;must_change_password:boolean}>('select * from profiles where id=$1',[id(90)])).rows[0];expect(profile.company_id).toBe(companyB);expect(profile.must_change_password).toBe(true);
  const jobs=(await db.query<{kind:string;state:string}>('select kind,state from email_jobs where user_id=$1 order by kind',[id(90)])).rows;expect(jobs).toEqual([{kind:'password',state:'blocked'},{kind:'welcome',state:'scheduled'}]);
 });
});

describe('Administrative API authorization predicates',()=>{
 const sys={id:system,role:'system_admin',company_id:'a'},a={id:adminA,role:'admin',company_id:'a'},b={id:adminB,role:'admin',company_id:'b'},tech={id:techA,role:'technician',company_id:'a'};
 it('restricts company administrators to their own company and protects platform accounts',()=>{expect(canAdminCompany(a,'a')).toBe(true);expect(canAdminCompany(a,'b')).toBe(false);expect(canAdminAccount(a,b)).toBe(false);expect(canAdminAccount(a,sys)).toBe(false);expect(canAdminAccount(a,tech)).toBe(true);expect(canAdminCompany(tech,'a')).toBe(false);});
 it('allows full system management and prevents company administrators from granting it',()=>{expect(canAdminAccount(sys,b)).toBe(true);expect(canAdminCompany(sys,'b')).toBe(true);expect(canAssignRole(a,'system_admin')).toBe(false);expect(canAssignRole(sys,'system_admin')).toBe(false);expect(canAssignRole(a,'admin')).toBe(true);expect(canAssignRole(sys,'unknown')).toBe(false);});
 it('validates company identifiers before provisioning',()=>{expect(validCompany('Empresa A','empresa-a')).toBe(true);expect(validCompany('A','a')).toBe(false);expect(validCompany('Empresa','outra/empresa')).toBe(false);});
});

describe('Scoped login constraints and updated card behavior',()=>{
 it('allows the same login in separate companies and in system administration but rejects repeats inside one namespace',async()=>{
  await user(id(90),'Pessoa','technician',companyA);await user(id(91),'Outra','admin',companyB);
  await db.query('update profiles set username=$1 where id in($2,$3)',['frederico.magalhaes',id(90),id(91)]);
  expect((await db.query('select * from profiles where username=$1',['frederico.magalhaes'])).rows).toHaveLength(3);
  await rejected('update profiles set username=$1 where id=$2',['frederico.magalhaes',techA],/unique|duplicate/);
  await user(id(92),'Novo','system_admin',companyB);await rejected('update profiles set username=$1 where id=$2',['frederico.magalhaes',id(92)],/unique|duplicate/);
 });
 it('accepts numeric login suffixes and keeps email protected even through Auth updates',async()=>{
  await db.query('update profiles set username=$1 where id=$2',['tecnico.nome482',techA]);await rejected('update auth.users set email=$1 where id=$2',['other@example.invalid',techA],/e-mail/);await rejected('update auth.users set email_change=$1 where id=$2',['other@example.invalid',techA],/e-mail/);
 });
 it('lets system administrators assign invited company members and edit development/testing cards without changing identity',async()=>{
  await as(system);const c=await card(pendingA,companyA,'Atividade para usuário convidado');await db.query("update activities set status='in_progress' where id=$1",[c.id]);const previous=(await db.query<{number:number;code:string}>('select number,code from activities where id=$1',[c.id])).rows[0];await db.query("update activities set title='Em validação',status='testing' where id=$1",[c.id]);expect((await db.query('select number,code from activities where id=$1',[c.id])).rows[0]).toEqual(previous);
  await as(pendingA);expect((await db.query('select * from activities where id=$1',[c.id])).rows).toHaveLength(0);
 });
});

describe('Billing integrity and public contact privacy',()=>{
 async function reserve(company=companyA,plan='monthly'){return (await db.query<{reserve_company_subscription:{created:boolean;subscription:{id:string;amount_cents:number}}}>('select reserve_company_subscription($1,$2,$3,$4,$5)',[company,'sandbox',plan,'PIX',system])).rows[0].reserve_company_subscription;}
 async function payment(sub:string,id:string,event:string,status='paid',amount=5990){return db.query('select record_billing_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)',['sandbox',event,'PAYMENT_RECEIVED',sub,id,amount,'2026-11-20',status,'https://sandbox.asaas.com/i/test']);}
 it('reserves prices from the server and reuses a pending subscription instead of duplicating it',async()=>{
  const first=await reserve(),second=await reserve(),annual=await reserve(companyB,'annual');expect(first.created).toBe(true);expect(second.created).toBe(false);expect(second.subscription.id).toBe(first.subscription.id);expect(first.subscription.amount_cents).toBe(5990);expect(annual.subscription.amount_cents).toBe(59900);
 });
 it('deduplicates payment events, validates amount and prevents cross-company payment reassignment',async()=>{
  const a=await reserve(),b=await reserve(companyB);await payment(a.subscription.id,'pay-a','evt-a');const repeat=await payment(a.subscription.id,'pay-a','evt-a');expect(repeat.rows[0]).toMatchObject({record_billing_payment:false});
  await rejected('select record_billing_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)',['sandbox','evt-tamper','PAYMENT_RECEIVED',a.subscription.id,'pay-tamper',1,'2026-11-20','paid',null],/Valor/);
  await rejected('select record_billing_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)',['sandbox','evt-cross','PAYMENT_RECEIVED',b.subscription.id,'pay-a',5990,'2026-11-20','paid',null],/outra assinatura/);
 });
 it('does not let an old overdue or paid event override settled or refunded payment state',async()=>{
  const a=await reserve();await payment(a.subscription.id,'pay-a','evt-paid');await payment(a.subscription.id,'pay-a','evt-old','overdue');expect((await db.query<{status:string}>('select status from billing_payments')).rows[0].status).toBe('paid');await payment(a.subscription.id,'pay-a','evt-refund','refunded');await payment(a.subscription.id,'pay-a','evt-repeated-paid');expect((await db.query<{status:string}>('select status from billing_payments')).rows[0].status).toBe('refunded');
 });
 it('protects billing and contact tables and mutation functions from browser roles',async()=>{
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const table of ['billing_plans','billing_subscriptions','billing_payments','billing_customers','billing_events','billing_integrations','contact_messages'])await rejected('select * from '+table);await rejected('select reserve_company_subscription($1,$2,$3,$4,$5)',[companyA,'sandbox','monthly','PIX',system]);await rejected('select * from claim_contact_messages()');await root();}
 });
 it('enforces ten active company members while exempting global administrators and inactive accounts',async()=>{
  for(let i=0;i<6;i++)await user(id(300+i),'Vaga'+String.fromCharCode(65+i),'technician',companyA);
  await db.query('insert into auth.users(id,email) values($1,$2)',[id(310),'over@example.invalid']);await rejected('insert into profiles(id,full_name,username,role,company_id) values($1,$2,$3,$4,$5)',[id(310),'Outra Pessoa','outra.pessoa','technician',companyA],/Limite/);
  await db.query("insert into profiles(id,full_name,username,role,company_id,active) values($1,$2,$3,'technician',$4,false)",[id(310),'Outra Pessoa','outra.pessoa',companyA]);await rejected('update profiles set active=true where id=$1',[id(310)],/Limite/);
  await user(id(311),'Globalextra','system_admin',companyA);
 });
 it('leases contact delivery and ignores stale acknowledgements',async()=>{
  await db.query("insert into contact_messages(name,email,category,subject,message) values('Pessoa','visitor@example.invalid','commercial','Conhecer plano','Mensagem de teste local')");
  const job=(await db.query<{id:string;claim_token:string}>('select * from claim_contact_messages()')).rows[0];expect((await db.query('select * from claim_contact_messages()')).rows).toHaveLength(0);
  await db.query('select finish_contact_message($1,$2,true)',[job.id,system]);expect((await db.query<{state:string}>('select state from contact_messages')).rows[0].state).toBe('sending');
  await db.query('select finish_contact_message($1,$2,true)',[job.id,job.claim_token]);expect((await db.query<{state:string}>('select state from contact_messages')).rows[0].state).toBe('sent');
 });
});

describe('Automatic e-mail identity lookup',()=>{
 it('resolves one account for the trusted server without a company selector',async()=>{await root();const email=(await db.query<{email:string}>('select email from auth.users where id=$1',[techA])).rows[0].email;await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'service_role'})]);await db.exec('set role service_role');expect((await db.query<{profile_id_for_email:string}>('select profile_id_for_email($1)',[email.toUpperCase()])).rows[0].profile_id_for_email).toBe(techA);expect((await db.query<{profile_id_for_email:null}>('select profile_id_for_email($1)',['missing@example.invalid'])).rows[0].profile_id_for_email).toBe(null);});
 it('does not expose the Auth email lookup to anonymous or signed-in browser roles',async()=>{for(const role of ['anon','authenticated']){await db.exec('set role '+role);await rejected("select profile_id_for_email('someone@example.invalid')");await root();}});
});

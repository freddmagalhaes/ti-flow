-- TI Flow schema. Apply through a versioned Supabase migration.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id),
 full_name text not null check(length(trim(full_name)) between 2 and 160),
 username text not null unique check(username ~ '^[a-z]+\.[a-z]+$'),
 role text not null check(role in ('admin','manager','technician')),
 active boolean not null default true,
 must_change_password boolean not null default true,
 password_expires_at timestamptz,
 welcome_status text not null default 'aguardando',
 password_status text not null default 'aguardando',
 created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create function private.has_access() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and not p.must_change_password)
 and exists(select 1 from auth.sessions s where s.id=nullif((select auth.jwt())->>'session_id','')::uuid and s.user_id=(select auth.uid()));
$$;
create function private.can_manage() returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_access() and exists(select 1 from public.profiles where id=(select auth.uid()) and role in ('admin','manager'));
$$;
revoke all on function private.has_access(),private.can_manage() from public,anon;
grant execute on function private.has_access(),private.can_manage() to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or (select private.has_access()));
grant select on public.profiles to authenticated;
revoke all on public.profiles from anon;

create function private.protect_last_admin() returns trigger language plpgsql set search_path='' as $$
begin
 if old.role='admin' and old.active and (not new.active or new.role<>'admin') and not exists(select 1 from public.profiles where id<>old.id and role='admin' and active) then
  raise exception 'Não é permitido remover o último administrador ativo.';
 end if;
 return new;
end;$$;
create trigger protect_last_admin before update on public.profiles for each row execute function private.protect_last_admin();

create table public.activities (
 id uuid primary key default gen_random_uuid(),
 number bigint generated always as identity unique,
 code text generated always as ('TI-'||case when number<1000000 then lpad(number::text,6,'0') else number::text end) stored,
 root_id uuid not null references public.activities(id) deferrable initially deferred,
 parent_id uuid references public.activities(id),
 title text not null check(length(trim(title)) between 1 and 180),
 description text not null default '' check(length(description)<=20000),
 status text not null default 'pending' check(status in('pending','in_progress','third_party','completed')),
 priority text not null default 'medium' check(priority in('low','medium','high','urgent')),
 assignee_id uuid not null references public.profiles(id),
 created_by uuid not null references public.profiles(id),
 start_date date not null,
 due_date date not null check(due_date>=start_date),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 closed_at timestamptz,
 closed_by uuid references public.profiles(id),
 version integer not null default 1,
 position double precision not null default 0,
 checklist jsonb not null default '[]' check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist)<=200),
 comments jsonb not null default '[]' check(jsonb_typeof(comments)='array' and jsonb_array_length(comments)<=2000),
 attachments jsonb not null default '[]' check(jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=100),
 reopen_reason text check(length(reopen_reason)<=2000),
 check((status='completed' and closed_at is not null and closed_by is not null) or (status<>'completed' and closed_at is null and closed_by is null)),
 check((parent_id is null and root_id=id and reopen_reason is null) or (parent_id is not null and parent_id<>id and reopen_reason is not null and length(trim(reopen_reason))>0))
);
create unique index one_open_card_per_chain on public.activities(root_id) where status<>'completed';
create index activities_status_assignee on public.activities(status,assignee_id);
create index activities_due_date on public.activities(due_date) where status<>'completed';
create index activities_parent on public.activities(parent_id);
alter table public.activities enable row level security;
create policy activities_read on public.activities for select to authenticated using((select private.has_access()));
create policy activities_create on public.activities for insert to authenticated with check(
 (select private.has_access()) and parent_id is null and root_id=id and status<>'completed' and created_by=(select auth.uid())
 and ((select private.can_manage()) or assignee_id=(select auth.uid()))
);
create policy activities_update on public.activities for update to authenticated using(
 (select private.has_access()) and status<>'completed' and ((select private.can_manage()) or assignee_id=(select auth.uid()))
) with check((select private.has_access()) and ((select private.can_manage()) or assignee_id=(select auth.uid())));
grant select,insert,update on public.activities to authenticated;
grant usage,select on sequence public.activities_number_seq to authenticated;
revoke all on public.activities from anon;

create table public.audit_events (
 id uuid primary key default gen_random_uuid(),
 activity_id uuid not null references public.activities(id),
 actor_id uuid not null references public.profiles(id),
 actor_name text not null,
 action text not null,
 details text,
 created_at timestamptz not null default now()
);
create index audit_activity_date on public.audit_events(activity_id,created_at desc);
alter table public.audit_events enable row level security;
create policy audit_read on public.audit_events for select to authenticated using((select private.has_access()));
grant select on public.audit_events to authenticated;
revoke all on public.audit_events from anon;

create function private.enforce_activity() returns trigger language plpgsql set search_path='' as $$
declare v_actor uuid; v_comment jsonb; v_name text;
begin
 v_actor:=auth.uid();
 if tg_op='DELETE' then raise exception 'Atividades não podem ser excluídas.'; end if;
 if tg_op='INSERT' then
  if new.root_id is null then new.root_id:=new.id;end if;
  new.title:=trim(new.title);new.created_at:=now();new.updated_at:=now();new.version:=1;
 else
  if old.status='completed' then raise exception 'Uma atividade concluída é somente para consulta.';end if;
  if new.id is distinct from old.id or new.number is distinct from old.number or new.root_id is distinct from old.root_id or new.parent_id is distinct from old.parent_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at or new.reopen_reason is distinct from old.reopen_reason then
   raise exception 'Identificadores, origem e vínculos não podem ser alterados.';
  end if;
  if new.status='completed' then
   new.closed_at:=now();new.closed_by:=v_actor;
  elsif new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by then
   raise exception 'Dados de finalização são protegidos.';
  end if;
  if new.comments is distinct from old.comments then
   if jsonb_array_length(new.comments)<>jsonb_array_length(old.comments)+1 or (new.comments - (jsonb_array_length(new.comments)-1))<>old.comments then raise exception 'Comentários anteriores não podem ser alterados.';end if;
   v_comment:=new.comments->-1;
   select full_name into v_name from public.profiles where id=v_actor;
   if v_comment->>'author_id' is distinct from v_actor::text or v_comment->>'author' is distinct from v_name or coalesce(length(trim(v_comment->>'text')),0) not between 1 and 5000 then raise exception 'Comentário inválido.';end if;
   new.comments:=jsonb_set(new.comments,array[(jsonb_array_length(new.comments)-1)::text,'created_at'],to_jsonb(now()));
  end if;
  new.title:=trim(new.title);new.updated_at:=now();new.version:=old.version+1;
 end if;
 if not exists(select 1 from public.profiles p where p.id=new.assignee_id and p.active and not p.must_change_password) then raise exception 'Selecione um responsável ativo com acesso habilitado.';end if;
 return new;
end;$$;
create trigger enforce_activity before insert or update or delete on public.activities for each row execute function private.enforce_activity();

create function private.audit_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text;v_actor uuid;v_name text;
begin
 v_actor:=auth.uid();
 select full_name into v_name from public.profiles where id=v_actor;
 if v_actor is null or v_name is null then raise exception 'Autor não identificado.';end if;
 if tg_op='INSERT' then v_action:=case when new.parent_id is null then 'Atividade criada' else 'Atividade reaberta' end;
 elsif new.status='completed' then v_action:='Atividade concluída';
 elsif old.status<>new.status then v_action:='Status atualizado';
 elsif old.comments<>new.comments then v_action:='Comentário adicionado';
 elsif old.checklist<>new.checklist then v_action:='Checklist atualizado';
 elsif old.attachments<>new.attachments then v_action:='Anexo adicionado';
 else v_action:='Atividade atualizada';end if;
 insert into public.audit_events(activity_id,actor_id,actor_name,action,details) values(new.id,v_actor,v_name,v_action,case when tg_op='INSERT' and new.parent_id is not null then 'Origem: '||(select code from public.activities where id=new.parent_id)||' · '||new.reopen_reason else null end);
 return new;
end;$$;
revoke all on function private.audit_activity() from public,anon,authenticated;
create trigger audit_activity after insert or update on public.activities for each row execute function private.audit_activity();

create function public.complete_activity(p_id uuid,p_version integer) returns public.activities language plpgsql security invoker set search_path='' as $$
declare v_card public.activities;
begin
 update public.activities set status='completed' where id=p_id and version=p_version and status<>'completed' returning * into v_card;
 if not found then raise exception 'Atividade alterada, finalizada ou sem permissão. Atualize os dados.';end if;
 return v_card;
end;$$;

create function private.reopen_activity(p_id uuid,p_reason text,p_start date,p_due date,p_assignee uuid) returns public.activities language plpgsql security definer set search_path='' as $$
declare v_source public.activities;v_new public.activities;v_actor uuid;v_checklist jsonb;
begin
 v_actor:=auth.uid();
 if v_actor is null or not private.has_access() then raise exception 'Acesso não autorizado.';end if;
 select * into v_source from public.activities where id=p_id;
 if not found or v_source.status<>'completed' then raise exception 'Somente atividades concluídas podem ser reabertas.';end if;
 if not private.can_manage() and (v_source.assignee_id<>v_actor or p_assignee<>v_actor) then raise exception 'Você não tem permissão para reabrir ou transferir esta atividade.';end if;
 if coalesce(length(trim(p_reason)),0) not between 1 and 2000 or p_start is null or p_due is null or p_due<p_start then raise exception 'Informe motivo e datas válidas.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_source.root_id::text,0));
 if exists(select 1 from public.activities where root_id=v_source.root_id and status<>'completed') then raise exception 'Já existe uma continuação ativa desta cadeia.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'text',i->>'text','done',false)),'[]') into v_checklist from jsonb_array_elements(v_source.checklist) i;
 insert into public.activities(root_id,parent_id,title,description,status,priority,assignee_id,created_by,start_date,due_date,position,checklist,attachments,reopen_reason)
 values(v_source.root_id,v_source.id,v_source.title,v_source.description,'pending',v_source.priority,p_assignee,v_actor,p_start,p_due,extract(epoch from now())*1000,v_checklist,v_source.attachments,trim(p_reason)) returning * into v_new;
 return v_new;
end;$$;
revoke all on function private.reopen_activity(uuid,text,date,date,uuid) from public,anon;
grant execute on function private.reopen_activity(uuid,text,date,date,uuid) to authenticated;
create function public.reopen_activity(p_id uuid,p_reason text,p_start date,p_due date,p_assignee uuid) returns public.activities language sql security invoker set search_path='' as $$select private.reopen_activity(p_id,p_reason,p_start,p_due,p_assignee);$$;
revoke all on function public.complete_activity(uuid,integer),public.reopen_activity(uuid,text,date,date,uuid) from public,anon;
grant execute on function public.complete_activity(uuid,integer),public.reopen_activity(uuid,text,date,date,uuid) to authenticated;

-- Server-only delivery state. No browser role can read queued credentials.
create table public.email_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 kind text not null check(kind in('welcome','password','recovery')),
 recipient text not null,
 encrypted_payload text,
 state text not null check(state in('blocked','scheduled','sending','sent','failed','cancelled')),
 send_at timestamptz,
 sent_at timestamptz,
 attempts integer not null default 0,
 lease_until timestamptz,
 claim_token uuid,
 created_at timestamptz not null default now()
);
create index email_jobs_due on public.email_jobs(state,send_at);
alter table public.email_jobs enable row level security;
revoke all on public.email_jobs from anon,authenticated;
create table public.password_resets (
 token_hash text primary key,
 user_id uuid not null references public.profiles(id),
 expires_at timestamptz not null,
 used_at timestamptz
);
alter table public.password_resets enable row level security;
revoke all on public.password_resets from anon,authenticated;
create table public.auth_attempts (key text primary key,window_start timestamptz not null default now(),attempts integer not null default 1);
alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon,authenticated;

create function public.consume_auth_attempt(p_key text,p_limit integer default 10) returns boolean language plpgsql set search_path='' as $$
declare v_attempts integer;
begin
 insert into public.auth_attempts(key) values(p_key) on conflict(key) do update set attempts=case when public.auth_attempts.window_start<now()-interval '15 minutes' then 1 else public.auth_attempts.attempts+1 end,window_start=case when public.auth_attempts.window_start<now()-interval '15 minutes' then now() else public.auth_attempts.window_start end returning attempts into v_attempts;
 return v_attempts<=p_limit;
end;$$;
create function public.claim_email_jobs() returns setof public.email_jobs language sql set search_path='' as $$
 update public.email_jobs j set state='sending',attempts=j.attempts+1,lease_until=now()+interval '5 minutes',claim_token=gen_random_uuid()
 where j.id in(select id from public.email_jobs where attempts<5 and ((state='scheduled' and send_at<=now()) or (state='sending' and lease_until<now())) order by send_at limit 5 for update skip locked) returning j.*;
$$;
create function public.finish_email_job(p_id uuid,p_claim uuid,p_success boolean) returns void language plpgsql set search_path='' as $$
declare v_job public.email_jobs;
begin
 select * into v_job from public.email_jobs where id=p_id and state='sending' and claim_token=p_claim for update;
 if not found then return;end if;
 if p_success then
  update public.email_jobs set state='sent',sent_at=now(),encrypted_payload=null,lease_until=null,claim_token=null where id=p_id;
  if v_job.kind='welcome' then
   update public.profiles set welcome_status='enviado',password_status='programado' where id=v_job.user_id;
   update public.email_jobs set state='scheduled',send_at=now()+interval '120 seconds' where user_id=v_job.user_id and kind='password' and state='blocked';
  elsif v_job.kind='password' then
   update public.profiles set password_status='enviado',password_expires_at=now()+interval '24 hours' where id=v_job.user_id and must_change_password;
  end if;
 else
  update public.email_jobs set state=case when attempts>=5 then 'failed' else 'scheduled' end,send_at=now()+interval '2 minutes',lease_until=null,claim_token=null where id=p_id;
  if v_job.attempts>=5 then
   if v_job.kind='welcome' then update public.profiles set welcome_status='falhou' where id=v_job.user_id;
   elsif v_job.kind='password' then update public.profiles set password_status='falhou' where id=v_job.user_id;end if;
  end if;
 end if;
end;$$;
create function public.create_account_records(p_user_id uuid,p_name text,p_username text,p_role text,p_email text,p_encrypted text) returns void language plpgsql set search_path='' as $$
begin
 insert into public.profiles(id,full_name,username,role) values(p_user_id,p_name,p_username,p_role);
 insert into public.email_jobs(user_id,kind,recipient,state,send_at) values(p_user_id,'welcome',p_email,'scheduled',now());
 insert into public.email_jobs(user_id,kind,recipient,state,encrypted_payload) values(p_user_id,'password',p_email,'blocked',p_encrypted);
end;$$;
revoke all on function public.consume_auth_attempt(text,integer),public.claim_email_jobs(),public.finish_email_job(uuid,uuid,boolean),public.create_account_records(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.consume_auth_attempt(text,integer),public.claim_email_jobs(),public.finish_email_job(uuid,uuid,boolean),public.create_account_records(uuid,text,text,text,text,text) to service_role;
grant all on public.profiles,public.activities,public.audit_events,public.email_jobs,public.password_resets,public.auth_attempts to service_role;
grant usage,select on sequence public.activities_number_seq to service_role;
revoke all on function private.enforce_activity(),private.protect_last_admin() from public,anon,authenticated;

create function private.session_valid() returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and exists(select 1 from auth.sessions s where s.id=nullif((select auth.jwt())->>'session_id','')::uuid and s.user_id=(select auth.uid()));
$$;
revoke all on function private.session_valid() from public,anon;
grant execute on function private.session_valid() to authenticated;
create function public.session_valid() returns boolean language sql stable security invoker set search_path='' as $$select private.session_valid();$$;
revoke all on function public.session_valid() from public,anon;
grant execute on function public.session_valid() to authenticated;

-- Any password change made outside the validated application flow locks data
-- access again. Only the server can clear this flag after validating the policy.
create function private.password_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.profiles set must_change_password=true,password_expires_at=null where id=new.id;
 return new;
end;$$;
revoke all on function private.password_changed() from public,anon,authenticated;
create trigger ti_flow_password_changed after update of encrypted_password on auth.users for each row
 when (old.encrypted_password is distinct from new.encrypted_password) execute function private.password_changed();

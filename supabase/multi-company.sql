-- Apply once after schema.sql and storage-and-realtime.sql.
create table public.companies (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 2 and 160),
 slug text not null unique check(length(slug) between 2 and 64 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.companies enable row level security;
revoke all on public.companies from anon,authenticated;
grant select on public.companies to authenticated;
grant all on public.companies to service_role;

alter table public.profiles add column company_id uuid references public.companies(id);
alter table public.activities add column company_id uuid references public.companies(id);
alter table public.audit_events add column company_id uuid references public.companies(id);
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in('system_admin','admin','manager','technician'));

-- Preserve every existing record, including immutable completed snapshots.
alter table public.activities disable trigger enforce_activity;
alter table public.activities disable trigger audit_activity;
alter table public.profiles disable trigger protect_last_admin;
do $$declare v_company uuid;begin
 insert into public.companies(name,slug) values('Automações TI','automacoes-ti') returning id into v_company;
 update public.profiles set company_id=v_company;
 update public.activities set company_id=v_company;
 update public.audit_events set company_id=v_company;
 update public.profiles p set role='system_admin'
 where p.username='frederico.magalhaes' and p.role='admin'
 and exists(select 1 from auth.users u where u.id=p.id and lower(u.email)='frederico.magalhaes@outlook.com');
end;$$;
alter table public.profiles enable trigger protect_last_admin;
alter table public.activities enable trigger enforce_activity;
alter table public.activities enable trigger audit_activity;
alter table public.profiles alter column company_id set not null;
alter table public.activities alter column company_id set not null;
alter table public.audit_events alter column company_id set not null;
create index profiles_company_role on public.profiles(company_id,role);
create index activities_company_status on public.activities(company_id,status);
create index audit_company_date on public.audit_events(company_id,created_at desc);
create unique index activities_id_company on public.activities(id,company_id);
alter table public.activities add constraint root_same_company foreign key(root_id,company_id) references public.activities(id,company_id) deferrable initially deferred;
alter table public.activities add constraint parent_same_company foreign key(parent_id,company_id) references public.activities(id,company_id);

create function private.actor_company() returns uuid language sql stable security definer set search_path='' as $$
 select company_id from public.profiles where id=(select auth.uid());
$$;
create or replace function private.has_access() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.companies c on c.id=p.company_id
 where p.id=(select auth.uid()) and p.active and not p.must_change_password and (p.role='system_admin' or c.active))
 and exists(select 1 from auth.sessions s where s.id=nullif((select auth.jwt())->>'session_id','')::uuid and s.user_id=(select auth.uid()));
$$;
create function private.is_system_admin() returns boolean language sql stable security definer set search_path='' as $$
 select private.has_access() and exists(select 1 from public.profiles where id=(select auth.uid()) and role='system_admin');
$$;
create function private.can_access_company(p_company uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_access() and (private.is_system_admin() or p_company=private.actor_company());
$$;
create or replace function private.can_manage() returns boolean language sql stable security definer set search_path='' as $$
 select private.has_access() and exists(select 1 from public.profiles where id=(select auth.uid()) and role in('system_admin','admin','manager'));
$$;
revoke all on function private.actor_company(),private.is_system_admin(),private.can_access_company(uuid) from public,anon;
grant execute on function private.actor_company(),private.is_system_admin(),private.can_access_company(uuid) to authenticated;
alter table public.activities alter column company_id set default private.actor_company();
create policy companies_read on public.companies for select to authenticated using(id=(select private.actor_company()) or (select private.is_system_admin()));
alter policy profiles_read on public.profiles using(id=(select auth.uid()) or ((select private.has_access()) and ((select private.is_system_admin()) or company_id=(select private.actor_company()))));
alter policy activities_read on public.activities using((select private.has_access()) and ((select private.is_system_admin()) or company_id=(select private.actor_company())));
alter policy activities_create on public.activities with check(
 private.can_access_company(company_id) and parent_id is null and root_id=id and status<>'completed' and created_by=(select auth.uid())
 and ((select private.can_manage()) or assignee_id=(select auth.uid()))
);
alter policy activities_update on public.activities using(
 private.can_access_company(company_id) and status<>'completed' and ((select private.can_manage()) or assignee_id=(select auth.uid()))
) with check(private.can_access_company(company_id) and ((select private.can_manage()) or assignee_id=(select auth.uid())));
alter policy audit_read on public.audit_events using((select private.has_access()) and ((select private.is_system_admin()) or company_id=(select private.actor_company())));

create or replace function private.protect_last_admin() returns trigger language plpgsql set search_path='' as $$
begin
 if new.company_id is distinct from old.company_id then raise exception 'A empresa do usuário não pode ser alterada.';end if;
 -- Serialize account administration to protect the last administrator under concurrent requests.
 perform pg_advisory_xact_lock(hashtextextended(case when old.role='system_admin' then 'ti-flow-system-admins' else old.company_id::text end,0));
 if old.active and old.role='system_admin' and (not new.active or new.role<>'system_admin')
 and not exists(select 1 from public.profiles where id<>old.id and role='system_admin' and active) then
  raise exception 'Não é permitido remover o último administrador do sistema.';
 end if;
 if old.active and old.role='admin' and (not new.active or new.role<>'admin')
 and not exists(select 1 from public.profiles where id<>old.id and company_id=old.company_id and role='admin' and active) then
  raise exception 'Não é permitido remover o último administrador da empresa.';
 end if;
 return new;
end;$$;

create function private.enforce_activity_company() returns trigger language plpgsql set search_path='' as $$
declare v_file jsonb;
begin
 if tg_op='UPDATE' and new.company_id is distinct from old.company_id then raise exception 'A empresa da atividade não pode ser alterada.';end if;
 if not exists(select 1 from public.profiles where id=new.assignee_id and company_id=new.company_id) then raise exception 'O responsável deve pertencer à mesma empresa.';end if;
 if tg_op='INSERT' and not exists(select 1 from public.profiles where id=new.created_by and (company_id=new.company_id or role='system_admin')) then raise exception 'Autor de outra empresa.';end if;
 if tg_op='INSERT' or new.attachments is distinct from old.attachments then
  for v_file in select value from jsonb_array_elements(new.attachments) loop
   if not exists(select 1 from public.activities where id::text=split_part(v_file->>'path','/',1) and company_id=new.company_id) then raise exception 'Anexo de outra empresa ou origem inválida.';end if;
  end loop;
 end if;
 return new;
end;$$;
revoke all on function private.enforce_activity_company() from public,anon,authenticated;
create trigger enforce_activity_company before insert or update on public.activities for each row execute function private.enforce_activity_company();

create or replace function private.audit_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text;v_actor uuid;v_name text;
begin
 v_actor:=auth.uid();select full_name into v_name from public.profiles where id=v_actor;
 if tg_op='INSERT' then v_action:=case when new.parent_id is null then 'Atividade criada' else 'Atividade reaberta' end;
 elsif old.status<>'completed' and new.status='completed' then v_action:='Atividade concluída';
 elsif old.status<>new.status then v_action:='Status atualizado';
 elsif old.comments<>new.comments then v_action:='Comentário adicionado';
 elsif old.checklist<>new.checklist then v_action:='Checklist atualizado';
 elsif old.attachments<>new.attachments then v_action:='Anexo adicionado';
 else v_action:='Atividade atualizada';end if;
 insert into public.audit_events(company_id,activity_id,actor_id,actor_name,action,details)
 values(new.company_id,new.id,v_actor,v_name,v_action,case when tg_op='INSERT' and new.parent_id is not null then 'Origem: '||(select code from public.activities where id=new.parent_id)||' · '||new.reopen_reason else null end);
 return new;
end;$$;

create or replace function private.reopen_activity(p_id uuid,p_reason text,p_start date,p_due date,p_assignee uuid) returns public.activities language plpgsql security definer set search_path='' as $$
declare v_source public.activities;v_new public.activities;v_actor uuid;v_checklist jsonb;
begin
 v_actor:=auth.uid();
 if v_actor is null or not private.has_access() then raise exception 'Acesso não autorizado.';end if;
 select * into v_source from public.activities where id=p_id and private.can_access_company(company_id);
 if not found or v_source.status<>'completed' then raise exception 'Atividade indisponível ou sem permissão.';end if;
 if not private.can_manage() and (v_source.assignee_id<>v_actor or p_assignee<>v_actor) then raise exception 'Você não tem permissão para reabrir ou transferir esta atividade.';end if;
 if coalesce(length(trim(p_reason)),0) not between 1 and 2000 or p_start is null or p_due is null or p_due<p_start then raise exception 'Informe motivo e datas válidas.';end if;
 if not exists(select 1 from public.profiles where id=p_assignee and company_id=v_source.company_id and active and not must_change_password) then raise exception 'Selecione um responsável ativo da mesma empresa.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_source.root_id::text,0));
 if exists(select 1 from public.activities where root_id=v_source.root_id and status<>'completed') then raise exception 'Já existe uma continuação ativa desta cadeia.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'text',i->>'text','done',false)),'[]') into v_checklist from jsonb_array_elements(v_source.checklist) i;
 insert into public.activities(company_id,root_id,parent_id,title,description,status,priority,assignee_id,created_by,start_date,due_date,position,checklist,attachments,reopen_reason)
 values(v_source.company_id,v_source.root_id,v_source.id,v_source.title,v_source.description,'pending',v_source.priority,p_assignee,v_actor,p_start,p_due,extract(epoch from now())*1000,v_checklist,v_source.attachments,trim(p_reason)) returning * into v_new;
 return v_new;
end;$$;

-- All private files are authorized through the original activity, including reopened copies.
alter policy attachments_read on storage.objects using(bucket_id='attachments' and exists(
 select 1 from public.activities a where a.id::text=(storage.foldername(objects.name))[1] and private.can_access_company(a.company_id)
));
alter policy attachments_upload on storage.objects with check(
 bucket_id='attachments' and exists(select 1 from public.activities a where a.id::text=(storage.foldername(objects.name))[1]
 and private.can_access_company(a.company_id) and a.status<>'completed' and ((select private.can_manage()) or a.assignee_id=(select auth.uid())))
 and lower(storage.extension(name))=any(array['pdf','png','jpg','jpeg','webp','gif','txt','csv','doc','docx','xls','xlsx','ppt','pptx'])
);

-- Provision profile and the two email jobs together. Called only by the trusted server.
create function public.create_company_account_records(p_user_id uuid,p_name text,p_username text,p_role text,p_email text,p_encrypted text,p_company uuid) returns void language plpgsql set search_path='' as $$
begin
 if p_role not in('system_admin','admin','manager','technician') or not exists(select 1 from public.companies where id=p_company and active) then raise exception 'Empresa ou perfil inválido.';end if;
 insert into public.profiles(id,full_name,username,role,company_id) values(p_user_id,p_name,p_username,p_role,p_company);
 insert into public.email_jobs(user_id,kind,recipient,state,send_at) values(p_user_id,'welcome',p_email,'scheduled',now());
 insert into public.email_jobs(user_id,kind,recipient,state,encrypted_payload) values(p_user_id,'password',p_email,'blocked',p_encrypted);
end;$$;
revoke all on function public.create_company_account_records(uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_company_account_records(uuid,text,text,text,text,text,uuid) to service_role;
revoke all on function public.create_account_records(uuid,text,text,text,text,text) from service_role;
alter publication supabase_realtime add table public.companies;



-- Logical deletion preserves audit records, attachments and immutable reopening links.
alter table public.activities add column deleted_at timestamptz, add column deleted_by uuid references public.profiles(id);
drop index public.one_open_card_per_chain;
create unique index one_open_card_per_chain on public.activities(root_id) where status<>'completed' and deleted_at is null;
alter table public.activities add constraint activity_deletion_pair check((deleted_at is null)=(deleted_by is null));
create or replace function private.enforce_activity() returns trigger language plpgsql set search_path='' as $$
declare v_actor uuid; v_comment jsonb; v_name text;
begin
 v_actor:=auth.uid();
 if tg_op='DELETE' then raise exception 'Atividades não podem ser excluídas.'; end if;
 if tg_op='INSERT' then
  if new.deleted_at is not null or new.deleted_by is not null then raise exception 'Uma atividade nova não pode estar excluída.';end if;
  if new.root_id is null then new.root_id:=new.id;end if;
  new.title:=trim(new.title);new.created_at:=now();new.updated_at:=now();new.version:=1;
 else
  if old.deleted_at is not null then raise exception 'Uma atividade excluída não pode ser alterada.';end if;
  if old.status='completed' then raise exception 'Uma atividade concluída é somente para consulta.';end if;
  if new.id is distinct from old.id or new.number is distinct from old.number or new.root_id is distinct from old.root_id or new.parent_id is distinct from old.parent_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at or new.reopen_reason is distinct from old.reopen_reason then
   raise exception 'Identificadores, origem e vínculos não podem ser alterados.';
  end if;
  if new.deleted_at is not null then
   if not private.has_access() or not private.can_access_company(old.company_id) or (not private.can_manage() and old.assignee_id<>v_actor) then raise exception 'Sem permissão para excluir esta atividade.';end if;
   if (to_jsonb(new)-'deleted_at'-'deleted_by'-'code') is distinct from (to_jsonb(old)-'deleted_at'-'deleted_by'-'code') then raise exception 'A exclusão não pode alterar os dados da atividade.';end if;
   new.deleted_at:=now();new.deleted_by:=v_actor;new.updated_at:=now();new.version:=old.version+1;return new;
  elsif new.deleted_by is distinct from old.deleted_by then raise exception 'Dados de exclusão protegidos.';
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
 if not exists(select 1 from public.profiles p where p.id=new.assignee_id and p.active) then raise exception 'Selecione um responsável ativo.';end if;
 return new;
end;$$;

create or replace function private.audit_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text;v_actor uuid;v_name text;
begin
 v_actor:=auth.uid();select full_name into v_name from public.profiles where id=v_actor;
 if tg_op='INSERT' then v_action:=case when new.parent_id is null then 'Atividade criada' else 'Atividade reaberta' end;
 elsif new.deleted_at is not null then v_action:='Atividade excluída';
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
 if exists(select 1 from public.activities where root_id=v_source.root_id and status<>'completed' and deleted_at is null) then raise exception 'Já existe uma continuação ativa desta cadeia.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'text',i->>'text','done',false)),'[]') into v_checklist from jsonb_array_elements(v_source.checklist) i;
 insert into public.activities(company_id,root_id,parent_id,title,description,status,priority,assignee_id,created_by,start_date,due_date,position,checklist,attachments,reopen_reason)
 values(v_source.company_id,v_source.root_id,v_source.id,v_source.title,v_source.description,'pending',v_source.priority,p_assignee,v_actor,p_start,p_due,extract(epoch from now())*1000,v_checklist,v_source.attachments,trim(p_reason)) returning * into v_new;
 return v_new;
end;$$;


create function public.delete_activity(p_id uuid,p_version integer) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.activities set deleted_at=now(),deleted_by=auth.uid() where id=p_id and version=p_version and status<>'completed' and deleted_at is null;
 if not found then raise exception 'Atividade alterada, finalizada, excluída ou sem permissão. Atualize os dados.';end if;
end;$$;
revoke all on function public.delete_activity(uuid,integer) from public,anon;
grant execute on function public.delete_activity(uuid,integer) to authenticated;

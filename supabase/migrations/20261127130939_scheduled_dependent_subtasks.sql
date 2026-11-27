create function private.validate_activity_subtasks() returns trigger language plpgsql security invoker set search_path='' as $$
declare
 v_old_list jsonb:='[]';v_result jsonb:='[]';v_item jsonb;v_old jsonb;v_previous jsonb;v_old_previous jsonb;
 v_id text;v_ids text[]:=array[]::text[];v_start text;v_due text;v_done boolean;v_started boolean;v_old_started boolean;
 v_started_at jsonb;v_completed_at jsonb;
begin
 if tg_op='UPDATE' then if new.checklist is not distinct from old.checklist then return new;end if;v_old_list:=old.checklist;end if;
 if jsonb_typeof(new.checklist)<>'array' or jsonb_array_length(new.checklist)>200 then raise exception 'O card pode ter até 200 subtarefas.';end if;
 for v_item in select value from jsonb_array_elements(new.checklist) with ordinality as entries(value,idx) order by idx loop
  if jsonb_typeof(v_item)<>'object' or jsonb_typeof(v_item->'id') is distinct from 'string' or jsonb_typeof(v_item->'text') is distinct from 'string' or jsonb_typeof(v_item->'done') is distinct from 'boolean' then raise exception 'Formato de subtarefa inválido.';end if;
  v_id:=v_item->>'id';
  if length(v_id) not between 1 and 100 or v_id=any(v_ids) or length(trim(v_item->>'text')) not between 1 and 500 then raise exception 'Confira os nomes e os identificadores das subtarefas.';end if;
  v_ids:=array_append(v_ids,v_id);
  if (v_item?'started' and jsonb_typeof(v_item->'started')<>'boolean') or (v_item?'block_next' and jsonb_typeof(v_item->'block_next')<>'boolean') then raise exception 'Situação ou dependência da subtarefa inválida.';end if;
  v_start:=coalesce(v_item->>'start_date','');v_due:=coalesce(v_item->>'due_date','');
  begin
   if v_start<>'' then if v_start!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Data inválida.';end if;perform v_start::date;end if;
   if v_due<>'' then if v_due!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Data inválida.';end if;perform v_due::date;end if;
  exception when others then raise exception 'Informe datas válidas para a subtarefa.';end;
  if v_start<>'' and v_due<>'' and v_due::date<v_start::date then raise exception 'O fim previsto da subtarefa deve ser igual ou posterior ao início.';end if;
  select value into v_old from jsonb_array_elements(v_old_list) where value->>'id'=v_id;
  v_done:=(v_item->>'done')::boolean;v_started:=v_done or coalesce((v_item->>'started')::boolean,false);
  v_old_started:=coalesce(v_old->'started'='true'::jsonb,false) or coalesce(v_old->'done'='true'::jsonb,false);
  if v_started and coalesce(v_previous->'block_next'='true'::jsonb,false) then
   select value into v_old_previous from jsonb_array_elements(v_old_list) where value->>'id'=v_previous->>'id';
   if not coalesce(v_previous->'done'='true'::jsonb,false) or (not v_old_started and not coalesce(v_old_previous->'done'='true'::jsonb,false)) then
    raise exception 'Subtarefa bloqueada: conclua a anterior antes de iniciar ou concluir a próxima. Para reabrir a anterior, retorne a próxima para A fazer primeiro.';
   end if;
  end if;
  v_started_at:=case when not v_started then 'null'::jsonb when v_old_started then coalesce(v_old->'started_at','null'::jsonb) else to_jsonb(now()) end;
  v_completed_at:=case when not v_done then 'null'::jsonb when coalesce(v_old->'done'='true'::jsonb,false) then coalesce(v_old->'completed_at','null'::jsonb) else to_jsonb(now()) end;
  v_previous:=jsonb_build_object('id',v_id,'text',trim(v_item->>'text'),'done',v_done,'started',v_started,'start_date',v_start,'due_date',v_due,'block_next',coalesce((v_item->>'block_next')::boolean,false),'started_at',v_started_at,'completed_at',v_completed_at);
  v_result:=v_result||jsonb_build_array(v_previous);
 end loop;
 new.checklist:=v_result;return new;
end;$$;
revoke all on function private.validate_activity_subtasks() from public,anon,authenticated;
create trigger validate_activity_subtasks before insert or update of checklist on public.activities for each row execute function private.validate_activity_subtasks();

-- New copies retain planning/dependencies while progress and actual timestamps restart.
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
 select coalesce(jsonb_agg(item||jsonb_build_object('id',gen_random_uuid(),'done',false,'started',false,'started_at',null,'completed_at',null) order by idx),'[]') into v_checklist from jsonb_array_elements(v_source.checklist) with ordinality as entries(item,idx);
 insert into public.activities(company_id,root_id,parent_id,title,description,status,priority,assignee_id,created_by,start_date,due_date,position,checklist,attachments,reopen_reason)
 values(v_source.company_id,v_source.root_id,v_source.id,v_source.title,v_source.description,'pending',v_source.priority,p_assignee,v_actor,p_start,p_due,extract(epoch from now())*1000,v_checklist,v_source.attachments,trim(p_reason)) returning * into v_new;
 return v_new;
end;$$;



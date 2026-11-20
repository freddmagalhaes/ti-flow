alter table public.activities drop constraint activities_status_check;
alter table public.activities add constraint activities_status_check check(status in('pending','in_progress','third_party','testing','completed'));
alter table public.profiles add column phone text not null default '' check(length(phone)<=30);
alter table public.profiles add column job_title text not null default '' check(length(job_title)<=100);
alter table public.profiles add column department text not null default '' check(length(department)<=100);
alter table public.companies add column legal_name text not null default '' check(length(legal_name)<=200);
alter table public.companies add column tax_id text not null default '' check(length(tax_id)<=30);
alter table public.companies add column contact_email text not null default '' check(length(contact_email)<=254);
alter table public.companies add column phone text not null default '' check(length(phone)<=30);
alter table public.companies add column address text not null default '' check(length(address)<=500);
alter table public.companies add column website text not null default '' check(length(website)<=200);

-- Account e-mail is immutable even if a client calls the Supabase Auth API directly.
create function private.protect_account_email() returns trigger language plpgsql set search_path='' as $$
begin
 if new.email is distinct from old.email or (coalesce(new.email_change,'')<>'' and new.email_change is distinct from old.email_change) then
  raise exception 'O e-mail de acesso não pode ser alterado.';
 end if;
 return new;
end $$;
revoke all on function private.protect_account_email() from public,anon,authenticated;
create trigger ti_flow_protect_account_email before update of email,email_change on auth.users
 for each row execute function private.protect_account_email();

-- Invited active users may receive work; login still requires their password change.
create or replace function private.enforce_activity() returns trigger language plpgsql set search_path='' as $$
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
 if not exists(select 1 from public.profiles p where p.id=new.assignee_id and p.active) then raise exception 'Selecione um responsável ativo.';end if;
 return new;
end;$$;

create table public.contact_messages (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 2 and 160),
 email text not null check(length(email)<=254),
 category text not null check(category in('commercial','question','support')),
 subject text not null check(length(subject) between 3 and 160),
 message text not null check(length(message) between 10 and 5000),
 created_at timestamptz not null default now(),
 state text not null default 'scheduled' check(state in('scheduled','sending','sent','failed')),
 attempts integer not null default 0,
 send_at timestamptz not null default now(),
 sent_at timestamptz,
 claim_token uuid
);
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from public,anon,authenticated;
grant all on public.contact_messages to service_role;
create index contact_messages_due on public.contact_messages(send_at) where state in('scheduled','sending');
create function public.claim_contact_messages() returns setof public.contact_messages language sql set search_path='' as $$
 update public.contact_messages set state='sending',attempts=attempts+1,claim_token=gen_random_uuid(),send_at=now()+interval '2 minutes'
 where id in(select id from public.contact_messages where state in('scheduled','sending') and send_at<=now() and attempts<5 and created_at>now()-interval '22 hours' order by send_at limit 3 for update skip locked) returning *;
$$;
create function public.finish_contact_message(p_id uuid,p_claim uuid,p_success boolean) returns void language sql set search_path='' as $$
 update public.contact_messages set state=case when p_success then 'sent' when attempts>=5 then 'failed' else 'scheduled' end,
 sent_at=case when p_success then now() else null end,send_at=now()+interval '5 minutes',claim_token=null
 where id=p_id and claim_token=p_claim and state='sending';
$$;
revoke all on function public.claim_contact_messages(),public.finish_contact_message(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_contact_messages(),public.finish_contact_message(uuid,uuid,boolean) to service_role;

-- Notification destination remains private in Vault.
create or replace function private.ti_flow_runtime_config() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if coalesce((select auth.jwt())->>'role','')<>'service_role' then raise exception 'Server access required.';end if;
 select coalesce(jsonb_object_agg(case name
  when 'ti_flow_mail_encryption_key' then 'MAIL_ENCRYPTION_KEY'
  when 'ti_flow_worker_secret' then 'EMAIL_WORKER_SECRET'
  when 'ti_flow_bootstrap_secret' then 'BOOTSTRAP_SECRET'
  when 'ti_flow_app_url' then 'APP_URL'
  when 'ti_flow_mail_from' then 'MAIL_FROM'
  when 'ti_flow_delivery_enabled' then 'EMAIL_DELIVERY_ENABLED'
  when 'ti_flow_contact_notification_email' then 'CONTACT_NOTIFICATION_EMAIL'
 end,decrypted_secret),'{}'::jsonb) into v_result from vault.decrypted_secrets where name in('ti_flow_mail_encryption_key','ti_flow_worker_secret','ti_flow_bootstrap_secret','ti_flow_app_url','ti_flow_mail_from','ti_flow_delivery_enabled','ti_flow_contact_notification_email');
 return v_result||jsonb_build_object('ALLOWED_ORIGIN',v_result->>'APP_URL');
end;$$;


revoke all on function private.ti_flow_runtime_config() from public,anon,authenticated;
grant execute on function private.ti_flow_runtime_config() to service_role;

-- Automatic sign-in/recovery by unique e-mail, without exposing Auth or tenant lists.
create function private.profile_id_for_email(p_email text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
 if coalesce((select auth.jwt())->>'role','')<>'service_role' then raise exception 'Server access required.';end if;
 select p.id into result from public.profiles p join auth.users u on u.id=p.id
 where lower(u.email)=lower(trim(p_email));
 return result;
end;$$;
revoke all on function private.profile_id_for_email(text) from public,anon,authenticated;
grant execute on function private.profile_id_for_email(text) to service_role;
create function public.profile_id_for_email(p_email text) returns uuid language sql stable security invoker set search_path='' as $$select private.profile_id_for_email(p_email);$$;
revoke all on function public.profile_id_for_email(text) from public,anon,authenticated;
grant execute on function public.profile_id_for_email(text) to service_role;

grant usage on schema private to service_role;

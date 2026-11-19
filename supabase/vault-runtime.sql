-- Server-only runtime configuration. Random values are generated inside Postgres
-- and encrypted by Supabase Vault; no credential is embedded in source files.
do $$
begin
 if not exists(select 1 from vault.secrets where name='ti_flow_mail_encryption_key') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'base64'),'ti_flow_mail_encryption_key','TI Flow email payload encryption');
 end if;
 if not exists(select 1 from vault.secrets where name='ti_flow_worker_secret') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'ti_flow_worker_secret','TI Flow email worker authentication');
 end if;
 if not exists(select 1 from vault.secrets where name='ti_flow_bootstrap_secret') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'ti_flow_bootstrap_secret','TI Flow first administrator activation; remove after use');
 end if;
 if not exists(select 1 from vault.secrets where name='ti_flow_app_url') then
  perform vault.create_secret('https://ti-flow-automacoes.meshedkayak2.chatgpt.site','ti_flow_app_url','TI Flow published origin');
 end if;
 if not exists(select 1 from vault.secrets where name='ti_flow_mail_from') then
  perform vault.create_secret('TI Flow <ti@automacoes.tec.br>','ti_flow_mail_from','TI Flow authorized sender');
 end if;
 if not exists(select 1 from vault.secrets where name='ti_flow_delivery_enabled') then
  perform vault.create_secret('false','ti_flow_delivery_enabled','Enable only after sender verification');
 end if;
 if not exists(select 1 from vault.secrets where name='ti_flow_worker_url') then
  perform vault.create_secret('https://zhmopjbrujhvuppluaar.supabase.co/functions/v1/ti-flow/worker/send-emails','ti_flow_worker_url','TI Flow email processor endpoint');
 end if;
end;$$;

create function private.ti_flow_runtime_config() returns jsonb language plpgsql security definer set search_path='' as $$
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
 end,decrypted_secret),'{}'::jsonb) into v_result from vault.decrypted_secrets where name in('ti_flow_mail_encryption_key','ti_flow_worker_secret','ti_flow_bootstrap_secret','ti_flow_app_url','ti_flow_mail_from','ti_flow_delivery_enabled');
 return v_result||jsonb_build_object('ALLOWED_ORIGIN',v_result->>'APP_URL');
end;$$;
revoke all on function private.ti_flow_runtime_config() from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.ti_flow_runtime_config() to service_role;
create function public.ti_flow_runtime_config() returns jsonb language sql security invoker set search_path='' as $$select private.ti_flow_runtime_config();$$;
revoke all on function public.ti_flow_runtime_config() from public,anon,authenticated;
grant execute on function public.ti_flow_runtime_config() to service_role;

-- Requires Supabase Cron, pg_net and Vault. Create these two Vault secrets
-- using Supabase Dashboard: ti_flow_worker_url and ti_flow_worker_secret.
-- URL: https://<project-ref>.supabase.co/functions/v1/ti-flow/worker/send-emails
-- Secret: the same value configured as EMAIL_WORKER_SECRET in Edge Functions.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('ti-flow-email-dispatch','30 seconds',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='ti_flow_worker_url'),
  headers:=jsonb_build_object('Content-Type','application/json','X-Worker-Secret',(select decrypted_secret from vault.decrypted_secrets where name='ti_flow_worker_secret')),
  body:='{}'::jsonb,
  timeout_milliseconds:=25000
 );
$job$);

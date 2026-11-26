-- Keep credential-table access inside the existing service-only identity lookup.
create or replace function public.requeue_access_emails(p_user uuid,p_email text,p_encrypted text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('access-mails:'||p_user::text,0));
 if not exists(select 1 from public.profiles p join public.companies c on c.id=p.company_id where p.id=p_user and p.active and (p.role='system_admin' or c.active) and private.profile_id_for_email(p_email)=p_user) then raise exception 'Conta indisponível para reenvio.';end if;
 if coalesce(length(p_encrypted),0)=0 then raise exception 'Credencial de envio indisponível.';end if;
 update public.email_jobs set state='cancelled',encrypted_payload=null,lease_until=null,claim_token=null
 where user_id=p_user and kind in('welcome','password') and state in('scheduled','sending','blocked','failed');
 update public.profiles set must_change_password=true,password_expires_at=null,welcome_status='aguardando',password_status='aguardando boas-vindas' where id=p_user;
 -- Fresh IDs are required: reusing a welcome ID would reuse the provider idempotency key.
 insert into public.email_jobs(user_id,kind,recipient,state,send_at) values(p_user,'welcome',p_email,'scheduled',now());
 insert into public.email_jobs(user_id,kind,recipient,state,encrypted_payload) values(p_user,'password',p_email,'blocked',p_encrypted);
end;$$;
revoke all on function public.requeue_access_emails(uuid,text,text) from public,anon,authenticated;
grant execute on function public.requeue_access_emails(uuid,text,text) to service_role;

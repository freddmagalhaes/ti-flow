create table public.billing_plans(
 id text primary key,
 name text not null,
 amount_cents integer not null check(amount_cents>0),
 months integer not null check(months in(1,12)),
 user_limit integer not null check(user_limit>0),
 active boolean not null default true
);
insert into public.billing_plans(id,name,amount_cents,months,user_limit) values('monthly','Flow Mensal',5990,1,10),('annual','Flow Anual',59900,12,10);
create table public.billing_integrations(
 environment text primary key check(environment in('sandbox','production')),
 webhook_id text not null,
 created_at timestamptz not null default now()
);
create table public.billing_customers(
 company_id uuid not null references public.companies(id),
 environment text not null check(environment in('sandbox','production')),
 provider_id text not null,
 primary key(company_id,environment),unique(environment,provider_id)
);
create table public.billing_subscriptions(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 environment text not null check(environment in('sandbox','production')),
 plan_id text not null references public.billing_plans(id),
 amount_cents integer not null check(amount_cents>0),
 months integer not null check(months in(1,12)),
 method text not null check(method in('PIX','CREDIT_CARD')),
 state text not null default 'creating' check(state in('creating','pending','active','uncertain','cancelled')),
 provider_id text,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 cancelled_at timestamptz,
 unique(environment,provider_id)
);
create unique index billing_one_open_subscription on public.billing_subscriptions(company_id,environment) where state<>'cancelled';
create index billing_subscription_plan on public.billing_subscriptions(plan_id);
create index billing_subscription_author on public.billing_subscriptions(created_by);
create table public.billing_payments(
 environment text not null,
 provider_id text not null,
 subscription_id uuid not null references public.billing_subscriptions(id),
 amount_cents integer not null,
 due_date date not null,
 status text not null check(status in('pending','paid','overdue','refunded','disputed','deleted')),
 invoice_url text,
 updated_at timestamptz not null default now(),
 primary key(environment,provider_id)
);
create index billing_payments_subscription on public.billing_payments(subscription_id,due_date desc);
create table public.billing_events(
 environment text not null,
 event_id text not null,
 event_type text not null,
 payment_id text,
 processed_at timestamptz not null default now(),
 primary key(environment,event_id)
);
alter table public.billing_plans enable row level security;
alter table public.billing_integrations enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.billing_plans,public.billing_integrations,public.billing_customers,public.billing_subscriptions,public.billing_payments,public.billing_events from public,anon,authenticated;
grant all on public.billing_plans,public.billing_integrations,public.billing_customers,public.billing_subscriptions,public.billing_payments,public.billing_events to service_role;

create function public.reserve_company_subscription(p_company uuid,p_environment text,p_plan text,p_method text,p_actor uuid) returns jsonb language plpgsql set search_path='' as $$
declare s public.billing_subscriptions;plan public.billing_plans;
begin
 perform 1 from public.companies where id=p_company and active for update;
 if not found then raise exception 'Empresa indisponível.';end if;
 select * into s from public.billing_subscriptions where company_id=p_company and environment=p_environment and state<>'cancelled';
 if found then return jsonb_build_object('subscription',to_jsonb(s),'created',false);end if;
 select * into plan from public.billing_plans where id=p_plan and active;
 if not found then raise exception 'Plano indisponível.';end if;
 insert into public.billing_subscriptions(company_id,environment,plan_id,amount_cents,months,method,created_by)
 values(p_company,p_environment,p_plan,plan.amount_cents,plan.months,p_method,p_actor) returning * into s;
 return jsonb_build_object('subscription',to_jsonb(s),'created',true);
end $$;
create function public.record_billing_payment(p_environment text,p_event_id text,p_event_type text,p_subscription uuid,p_payment text,p_amount integer,p_due date,p_status text,p_url text) returns boolean language plpgsql set search_path='' as $$
declare sub public.billing_subscriptions;
begin
 select * into sub from public.billing_subscriptions where id=p_subscription and environment=p_environment for update;
 if not found then raise exception 'Assinatura não encontrada.';end if;
 if p_amount<>sub.amount_cents then raise exception 'Valor da cobrança diverge do plano contratado.';end if;
 insert into public.billing_events(environment,event_id,event_type,payment_id) values(p_environment,p_event_id,p_event_type,p_payment) on conflict do nothing;
 if not found then return false;end if;
 if exists(select 1 from public.billing_payments where environment=p_environment and provider_id=p_payment and subscription_id<>p_subscription) then raise exception 'Cobrança de outra assinatura.';end if;
 insert into public.billing_payments(environment,provider_id,subscription_id,amount_cents,due_date,status,invoice_url)
 values(p_environment,p_payment,p_subscription,p_amount,p_due,p_status,p_url)
 on conflict(environment,provider_id) do update set
 status=case when public.billing_payments.status in('refunded','disputed') then public.billing_payments.status when public.billing_payments.status='paid' and excluded.status in('pending','overdue','deleted') then 'paid' else excluded.status end,
 invoice_url=coalesce(excluded.invoice_url,public.billing_payments.invoice_url),updated_at=now();
 if sub.state<>'cancelled' and p_status='paid' then update public.billing_subscriptions set state='active' where id=sub.id;end if;
 return true;
end $$;
revoke all on function public.reserve_company_subscription(uuid,text,text,text,uuid),public.record_billing_payment(text,text,text,uuid,text,integer,date,text,text) from public,anon,authenticated;
grant execute on function public.reserve_company_subscription(uuid,text,text,text,uuid),public.record_billing_payment(text,text,text,uuid,text,integer,date,text,text) to service_role;

alter table public.companies add column user_limit integer not null default 10 check(user_limit between 1 and 10000);
create function private.enforce_company_user_limit() returns trigger language plpgsql set search_path='' as $$
declare max_users integer;
begin
 if new.role='system_admin' or not new.active then return new;end if;
 if tg_op='UPDATE' and old.active and old.role<>'system_admin' and new.company_id=old.company_id then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('flow-seats:'||new.company_id::text,0));
 select user_limit into max_users from public.companies where id=new.company_id;
 if (select count(*) from public.profiles where company_id=new.company_id and active and role<>'system_admin' and id<>new.id)>=max_users then raise exception 'Limite de usuários ativos da empresa atingido.';end if;
 return new;
end $$;
revoke all on function private.enforce_company_user_limit() from public,anon,authenticated;
create trigger limit_active_company_users before insert or update on public.profiles for each row execute function private.enforce_company_user_limit();

do $$begin
 if not exists(select 1 from vault.secrets where name='ti_flow_asaas_webhook_token') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'ti_flow_asaas_webhook_token','TI Flow Asaas webhook authentication');
 end if;
end $$;

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
  when 'ti_flow_asaas_webhook_token' then 'ASAAS_WEBHOOK_TOKEN'
 end,decrypted_secret),'{}'::jsonb) into v_result from vault.decrypted_secrets where name in('ti_flow_mail_encryption_key','ti_flow_worker_secret','ti_flow_bootstrap_secret','ti_flow_app_url','ti_flow_mail_from','ti_flow_delivery_enabled','ti_flow_contact_notification_email','ti_flow_asaas_webhook_token');
 return v_result||jsonb_build_object('ALLOWED_ORIGIN',v_result->>'APP_URL');
end;$$;


revoke all on function private.ti_flow_runtime_config() from public,anon,authenticated;
grant execute on function private.ti_flow_runtime_config() to service_role;

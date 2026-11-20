-- Public subscriptions are handled by the Edge Function. No client table access.
create table public.newsletter_subscribers (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check (email=lower(email) and length(email)<=254),
 state text not null default 'pending' check (state in ('pending','confirmed','unsubscribed')),
 confirmation_hash text unique,
 confirmation_expires_at timestamptz,
 unsubscribe_hash text not null unique,
 encrypted_unsubscribe text not null,
 consent_version text not null default 'flow-news-v1',
 requested_at timestamptz not null default now(),
 confirmed_at timestamptz,
 unsubscribed_at timestamptz
);
create index newsletter_subscribers_state_idx on public.newsletter_subscribers(state);
create table public.newsletter_campaigns (
 id uuid primary key default gen_random_uuid(),
 subject text not null check (length(subject) between 3 and 160),
 content text not null check (length(content) between 10 and 12000),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 queued_at timestamptz
);
create index newsletter_campaigns_author_idx on public.newsletter_campaigns(created_by);
create table public.newsletter_jobs (
 id uuid primary key default gen_random_uuid(),
 subscriber_id uuid not null references public.newsletter_subscribers(id) on delete cascade,
 campaign_id uuid references public.newsletter_campaigns(id),
 kind text not null check (kind in ('confirmation','campaign')),
 confirmation_hash text,
 encrypted_payload text,
 state text not null default 'scheduled' check (state in ('scheduled','sending','sent','failed','cancelled')),
 attempts integer not null default 0,
 send_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 claim_token uuid,
 unique(campaign_id,subscriber_id),
 check ((kind='confirmation' and campaign_id is null and confirmation_hash is not null) or (kind='campaign' and campaign_id is not null))
);
create index newsletter_jobs_due_idx on public.newsletter_jobs(send_at) where state in ('scheduled','sending');
create index newsletter_jobs_subscriber_idx on public.newsletter_jobs(subscriber_id);
alter table public.newsletter_subscribers enable row level security;
alter table public.newsletter_campaigns enable row level security;
alter table public.newsletter_jobs enable row level security;
revoke all on public.newsletter_subscribers,public.newsletter_campaigns,public.newsletter_jobs from public,anon,authenticated;
grant all on public.newsletter_subscribers,public.newsletter_campaigns,public.newsletter_jobs to service_role;

create function public.newsletter_request(p_email text,p_hash text,p_unsubscribe_hash text,p_unsubscribe text,p_payload text) returns void
language plpgsql set search_path='' as $$
declare s public.newsletter_subscribers;
begin
 insert into public.newsletter_subscribers(email,unsubscribe_hash,encrypted_unsubscribe)
 values(p_email,p_unsubscribe_hash,p_unsubscribe) on conflict(email) do nothing;
 select * into s from public.newsletter_subscribers where email=p_email for update;
 if s.state='confirmed' or (s.confirmation_hash is not null and s.requested_at>now()-interval '15 minutes') then return; end if;
 update public.newsletter_jobs set state='cancelled',encrypted_payload=null where subscriber_id=s.id and state in ('scheduled','sending','failed');
 update public.newsletter_subscribers set state='pending',confirmation_hash=p_hash,confirmation_expires_at=now()+interval '24 hours',
 unsubscribe_hash=p_unsubscribe_hash,encrypted_unsubscribe=p_unsubscribe,requested_at=now(),confirmed_at=null,unsubscribed_at=null where id=s.id;
 insert into public.newsletter_jobs(subscriber_id,kind,confirmation_hash,encrypted_payload) values(s.id,'confirmation',p_hash,p_payload);
end $$;
create function public.newsletter_confirm(p_hash text) returns boolean language plpgsql set search_path='' as $$
begin
 update public.newsletter_subscribers set state='confirmed',confirmed_at=now(),confirmation_hash=null,confirmation_expires_at=null
 where state='pending' and confirmation_hash=p_hash and confirmation_expires_at>now();
 return found;
end $$;
create function public.newsletter_unsubscribe(p_hash text) returns void language plpgsql set search_path='' as $$
declare sid uuid;
begin
 update public.newsletter_subscribers set state='unsubscribed',unsubscribed_at=now(),confirmation_hash=null,confirmation_expires_at=null
 where unsubscribe_hash=p_hash returning id into sid;
 update public.newsletter_jobs set state='cancelled',encrypted_payload=null where subscriber_id=sid and state in ('scheduled','sending','failed');
end $$;
create function public.newsletter_publish(p_id uuid) returns integer language plpgsql set search_path='' as $$
declare amount integer;
begin
 perform 1 from public.newsletter_campaigns where id=p_id and queued_at is null for update;
 if not found then raise exception 'Esta edição já foi programada ou não existe.'; end if;
 insert into public.newsletter_jobs(subscriber_id,campaign_id,kind)
 select id,p_id,'campaign' from public.newsletter_subscribers where state='confirmed';
 get diagnostics amount=row_count;
 if amount=0 then raise exception 'Ainda não há assinantes confirmados.'; end if;
 update public.newsletter_campaigns set queued_at=now() where id=p_id;
 return amount;
end $$;
create function public.claim_newsletter_jobs() returns setof public.newsletter_jobs language sql set search_path='' as $$
 update public.newsletter_jobs set state='sending',attempts=attempts+1,claim_token=gen_random_uuid(),send_at=now()+interval '2 minutes'
 where id in (select id from public.newsletter_jobs where ((state='scheduled' and send_at<=now()) or (state='sending' and send_at<=now()))
 and attempts<5 and created_at>now()-interval '22 hours' order by send_at limit 5 for update skip locked) returning *;
$$;
create function public.finish_newsletter_job(p_id uuid,p_claim uuid,p_success boolean) returns void language sql set search_path='' as $$
 update public.newsletter_jobs set state=case when p_success then 'sent' when attempts>=5 then 'failed' else 'scheduled' end,
 sent_at=case when p_success then now() else null end,send_at=now()+interval '5 minutes',claim_token=null,
 encrypted_payload=case when p_success or attempts>=5 then null else encrypted_payload end
 where id=p_id and claim_token=p_claim and state='sending';
$$;
revoke all on function public.newsletter_request(text,text,text,text,text),public.newsletter_confirm(text),public.newsletter_unsubscribe(text),public.newsletter_publish(uuid),public.claim_newsletter_jobs(),public.finish_newsletter_job(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.newsletter_request(text,text,text,text,text),public.newsletter_confirm(text),public.newsletter_unsubscribe(text),public.newsletter_publish(uuid),public.claim_newsletter_jobs(),public.finish_newsletter_job(uuid,uuid,boolean) to service_role;

create function public.newsletter_overview() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
  'counts',(select jsonb_build_object('confirmed',count(*) filter(where state='confirmed'),'pending',count(*) filter(where state='pending'),'unsubscribed',count(*) filter(where state='unsubscribed')) from public.newsletter_subscribers),
  'campaigns',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('delivery',
    (select jsonb_build_object('sent',count(*) filter(where state='sent'),'scheduled',count(*) filter(where state='scheduled'),'sending',count(*) filter(where state='sending'),'failed',count(*) filter(where state='failed'),'cancelled',count(*) filter(where state='cancelled')) from public.newsletter_jobs j where j.campaign_id=c.id)) order by c.created_at desc)
    from (select * from public.newsletter_campaigns order by created_at desc limit 30) c),'[]'::jsonb)
 );
$$;
revoke all on function public.newsletter_overview() from public,anon,authenticated;
grant execute on function public.newsletter_overview() to service_role;

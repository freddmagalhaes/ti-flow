alter table public.companies add column activity_emails_enabled boolean not null default true,
 add column notification_timezone text not null default 'America/Sao_Paulo',
 add column notification_hour integer not null default 9 check(notification_hour between 8 and 17);
alter table public.profiles add column activity_emails_enabled boolean not null default true;
create table public.activity_email_jobs(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 recipient_id uuid not null references public.profiles(id), kind text not null check(kind in('assigned','due_soon','overdue','overdue_digest')),
 dedup_key text not null unique, items jsonb not null, notification_date date, created_at timestamptz not null default now(),
 state text not null default 'scheduled' check(state in('scheduled','sending','sent','failed','cancelled')),
 send_at timestamptz not null default now(), attempts integer not null default 0, claim_token uuid, sent_at timestamptz
);
alter table public.activity_email_jobs enable row level security;
revoke all on public.activity_email_jobs from public,anon,authenticated;
grant all on public.activity_email_jobs to service_role;
create index activity_email_jobs_due on public.activity_email_jobs(send_at) where state in('scheduled','sending');
create index activity_email_jobs_company on public.activity_email_jobs(company_id);
create index activity_email_jobs_recipient on public.activity_email_jobs(recipient_id);
create index activities_notification_deadlines on public.activities(due_date,company_id,assignee_id) where status<>'completed' and deleted_at is null;

create function private.activity_workday(p_day date,p_direction integer) returns date language plpgsql immutable set search_path='' as $$
begin while extract(isodow from p_day)>5 loop p_day:=p_day+p_direction;end loop;return p_day;end;$$;
revoke all on function private.activity_workday(date,integer) from public,anon,authenticated;

create function private.queue_activity_assignment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.assignee_id is not distinct from old.assignee_id then return new;end if;
  update public.activity_email_jobs set state='cancelled',claim_token=null where kind='assigned' and state in('scheduled','sending') and items @> jsonb_build_array(jsonb_build_object('id',new.id));
 end if;
 if new.status='completed' or new.deleted_at is not null then return new;end if;
 if exists(select 1 from public.companies c join public.profiles p on p.company_id=c.id where c.id=new.company_id and c.active and c.activity_emails_enabled and p.id=new.assignee_id and p.active and p.activity_emails_enabled) then
  insert into public.activity_email_jobs(company_id,recipient_id,kind,dedup_key,items)
  values(new.company_id,new.assignee_id,'assigned','assigned:'||new.id||':'||new.version,jsonb_build_array(jsonb_build_object('id',new.id,'due_date',new.due_date))) on conflict(dedup_key) do nothing;
 end if;return new;
end;$$;
revoke all on function private.queue_activity_assignment() from public,anon,authenticated;
create trigger queue_activity_assignment after insert or update of assignee_id on public.activities for each row execute function private.queue_activity_assignment();

create function private.schedule_activity_emails(p_now timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
 with eligible as(
  select a.id,a.company_id,a.assignee_id,a.due_date,(p_now at time zone c.notification_timezone)::date as day
  from public.activities a join public.companies c on c.id=a.company_id join public.profiles p on p.id=a.assignee_id and p.company_id=c.id
  where c.active and c.activity_emails_enabled and p.active and p.activity_emails_enabled and a.status<>'completed' and a.deleted_at is null
  and extract(isodow from p_now at time zone c.notification_timezone)<=5
  and extract(hour from p_now at time zone c.notification_timezone)>=c.notification_hour
  and extract(hour from p_now at time zone c.notification_timezone)<18
 ), singles as(
  select e.*,case when day=private.activity_workday(due_date-1,-1) then 'due_soon' else 'overdue' end as kind from eligible e
  where day=private.activity_workday(due_date-1,-1) or day=private.activity_workday(due_date+1,1)
 ) insert into public.activity_email_jobs(company_id,recipient_id,kind,dedup_key,items,notification_date)
 select company_id,assignee_id,kind,kind||':'||id||':'||assignee_id||':'||due_date,jsonb_build_array(jsonb_build_object('id',id,'due_date',due_date)),day from singles on conflict(dedup_key) do nothing;
 with eligible as(
  select a.id,a.company_id,a.assignee_id,a.due_date,(p_now at time zone c.notification_timezone)::date as day
  from public.activities a join public.companies c on c.id=a.company_id join public.profiles p on p.id=a.assignee_id and p.company_id=c.id
  where c.active and c.activity_emails_enabled and p.active and p.activity_emails_enabled and a.status<>'completed' and a.deleted_at is null
  and extract(isodow from p_now at time zone c.notification_timezone)<=5
  and extract(hour from p_now at time zone c.notification_timezone)>=c.notification_hour
  and extract(hour from p_now at time zone c.notification_timezone)<18
 ) insert into public.activity_email_jobs(company_id,recipient_id,kind,dedup_key,items,notification_date)
 select company_id,assignee_id,'overdue_digest','digest:'||company_id||':'||assignee_id||':'||day,jsonb_agg(jsonb_build_object('id',id,'due_date',due_date) order by due_date,id),day
 from eligible where day>private.activity_workday(due_date+1,1) group by company_id,assignee_id,day on conflict(dedup_key) do nothing;
end;$$;
revoke all on function private.schedule_activity_emails(timestamptz) from public,anon,authenticated;

create function public.claim_activity_emails() returns setof public.activity_email_jobs language plpgsql security invoker set search_path='' as $$
begin
 perform private.schedule_activity_emails(now());
 update public.activity_email_jobs set state='failed',claim_token=null where state in('scheduled','sending') and created_at<=now()-interval '22 hours';
 return query update public.activity_email_jobs set state='sending',attempts=attempts+1,claim_token=gen_random_uuid(),send_at=now()+interval '2 minutes'
 where id in(select id from public.activity_email_jobs where state in('scheduled','sending') and send_at<=now() and attempts<5 and created_at>now()-interval '22 hours' order by created_at limit 5 for update skip locked) returning *;
end;$$;
grant execute on function private.schedule_activity_emails(timestamptz) to service_role;

create function public.activity_email_context(p_id uuid,p_claim uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('company',c.name,'kind',j.kind,'recipient_id',p.id,'timezone',c.notification_timezone,'cards',(
  select jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'title',a.title,'priority',a.priority,'due_date',a.due_date) order by a.due_date,a.number)
  from jsonb_array_elements(j.items) i join public.activities a on a.id=(i->>'id')::uuid
  where a.company_id=j.company_id and a.assignee_id=j.recipient_id and a.deleted_at is null and a.status<>'completed'
  and (j.kind='assigned' or a.due_date=(i->>'due_date')::date)
  and (j.kind not in('overdue','overdue_digest') or a.due_date<(now() at time zone c.notification_timezone)::date)
 ))
 from public.activity_email_jobs j join public.companies c on c.id=j.company_id join public.profiles p on p.id=j.recipient_id and p.company_id=c.id
 where j.id=p_id and j.claim_token=p_claim and j.state='sending' and c.active and c.activity_emails_enabled and p.active and p.activity_emails_enabled
 and (j.kind='assigned' or (j.notification_date=(now() at time zone c.notification_timezone)::date and extract(isodow from now() at time zone c.notification_timezone)<=5 and extract(hour from now() at time zone c.notification_timezone)>=c.notification_hour and extract(hour from now() at time zone c.notification_timezone)<18));
$$;
create function public.finish_activity_email(p_id uuid,p_claim uuid,p_result text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_result not in('sent','cancelled','failed') then raise exception 'Invalid queue result';end if;
 update public.activity_email_jobs set state=case when p_result in('sent','cancelled') then p_result when attempts>=5 then 'failed' else 'scheduled' end,
 sent_at=case when p_result='sent' then now() else null end,send_at=now()+interval '5 minutes',claim_token=null
 where id=p_id and state='sending' and claim_token=p_claim;
end;$$;
revoke all on function public.claim_activity_emails(),public.activity_email_context(uuid,uuid),public.finish_activity_email(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_activity_emails(),public.activity_email_context(uuid,uuid),public.finish_activity_email(uuid,uuid,text) to service_role;

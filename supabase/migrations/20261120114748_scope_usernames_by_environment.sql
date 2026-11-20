-- Existing accounts, passwords, memberships and activity history stay intact.
-- System administrators share a platform namespace; other roles use their company.
alter table public.profiles drop constraint profiles_username_key;
alter table public.profiles drop constraint profiles_username_check;
alter table public.profiles add constraint profiles_username_check
 check(length(username)<=100 and username ~ '^[a-z]+\.[a-z]+[0-9]{0,6}$');
create unique index profiles_company_username_unique on public.profiles(company_id,username)
 where role<>'system_admin';
create unique index profiles_system_username_unique on public.profiles(username)
 where role='system_admin';
-- Supports compatibility lookup for old clients; ambiguous names never pick an account.
create index profiles_username_lookup on public.profiles(username);

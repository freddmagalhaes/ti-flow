alter table public.profiles add column avatar_preset text not null default 'initials'
 check(avatar_preset in('initials','sunny','orbit','sprout','cosmo','pixel','peach','bloom','wave','photo')),
 add column avatar_path text not null default ''
 check(avatar_path='' or (split_part(avatar_path,'/',1)=id::text and avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('profile-avatars','profile-avatars',false,307200,array['image/jpeg']);
create policy profile_avatars_read on storage.objects for select to authenticated using(
 bucket_id='profile-avatars' and (select private.has_access()) and exists(
  select 1 from public.profiles p where p.id::text=(storage.foldername(name))[1] and private.can_access_company(p.company_id)
 )
);
-- Uploads, replacements and cleanup go through the authenticated profile API.
-- There are deliberately no client INSERT/UPDATE/DELETE policies for this bucket.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('attachments','attachments',false,10485760,array['application/pdf','image/png','image/jpeg','image/webp','image/gif','text/plain','text/csv','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy attachments_read on storage.objects for select to authenticated using(bucket_id='attachments' and (select private.has_access()));
create policy attachments_upload on storage.objects for insert to authenticated with check(
 bucket_id='attachments' and (select private.has_access()) and exists(
  select 1 from public.activities a where a.id::text=(storage.foldername(name))[1] and a.status<>'completed' and ((select private.can_manage()) or a.assignee_id=(select auth.uid()))
 ) and lower(storage.extension(name))=any(array['pdf','png','jpg','jpeg','webp','gif','txt','csv','doc','docx','xls','xlsx','ppt','pptx'])
);
-- No UPDATE/DELETE policy: existing files, including archived evidence, are immutable.
alter publication supabase_realtime add table public.activities,public.profiles;

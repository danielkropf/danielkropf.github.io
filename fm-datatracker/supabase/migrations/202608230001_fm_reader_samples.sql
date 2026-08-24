-- Optional, private diagnostic samples. Files are only uploaded after the
-- owner explicitly opts in following a failed CSV × .fm validation.
insert into storage.buckets (id,name,public,file_size_limit)
values ('fm-reader-samples','fm-reader-samples',false,209715200)
on conflict (id) do nothing;

create table if not exists public.fm_reader_samples (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  save_id uuid not null references public.saves(id) on delete cascade,
  fm_path text,
  csv_path text,
  comparison jsonb not null default '{}'::jsonb,
  parser_version text not null default 'offline-v0.22',
  created_at timestamptz not null default now()
);
alter table public.fm_reader_samples enable row level security;
create policy fm_reader_samples_owner on public.fm_reader_samples for all using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy fm_reader_samples_upload on storage.objects for insert to authenticated with check(bucket_id='fm-reader-samples' and (storage.foldername(name))[1]=auth.uid()::text);
create policy fm_reader_samples_read on storage.objects for select to authenticated using(bucket_id='fm-reader-samples' and owner_id=auth.uid());

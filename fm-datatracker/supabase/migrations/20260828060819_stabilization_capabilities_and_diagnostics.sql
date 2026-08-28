-- FM DataTracker stabilization: restore transactional delete RPC, make schema capabilities factual,
-- and provision private diagnostic uploads with reservation-based ownership.

create or replace function public.delete_fm_import(
  p_save_id uuid,
  p_import_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_owner uuid := auth.uid();
  v_deleted int := 0;
  v_latest_squad uuid;
  v_latest_squad_date date;
begin
  if v_owner is null then
    raise exception 'Usuário não autenticado';
  end if;
  if not exists(select 1 from saves where id=p_save_id and owner_id=v_owner) then
    raise exception 'Save não encontrado';
  end if;

  delete from imports
  where id=p_import_id and save_id=p_save_id and owner_id=v_owner;
  get diagnostics v_deleted = row_count;

  if v_deleted=0 then
    raise exception 'Importação não encontrada';
  end if;

  delete from contracts c
  using players p
  where c.player_id=p.id
    and p.save_id=p_save_id
    and not exists(
      select 1 from player_snapshots ps
      where ps.player_id=c.player_id
        and ps.snapshot_date=c.snapshot_date
        and ps.contract_expiry is not null
    );

  delete from players p
  where p.save_id=p_save_id
    and not exists(select 1 from player_snapshots ps where ps.player_id=p.id)
    and not exists(select 1 from player_stats st where st.player_id=p.id);

  with dates as (
    select player_id,min(snapshot_date) as first_seen,max(snapshot_date) as last_seen
    from (
      select player_id,snapshot_date from player_snapshots where save_id=p_save_id
      union all
      select player_id,snapshot_date from player_stats where save_id=p_save_id
    ) q
    group by player_id
  )
  update players p
  set first_seen_date=d.first_seen,
      last_seen_date=d.last_seen,
      updated_at=now()
  from dates d
  where p.id=d.player_id and p.save_id=p_save_id;

  select id,snapshot_date into v_latest_squad,v_latest_squad_date
  from imports
  where save_id=p_save_id and file_type='squad' and status='imported'
  order by snapshot_date desc,created_at desc,id desc
  limit 1;

  update players set is_active=false,updated_at=now() where save_id=p_save_id;

  if v_latest_squad is not null then
    update players p
    set is_active=true,updated_at=now()
    where p.save_id=p_save_id
      and (
        exists(
          select 1 from player_snapshots ps
          where ps.player_id=p.id and ps.import_id=v_latest_squad
        )
        or exists(
          select 1
          from player_snapshots ps
          join imports i on i.id=ps.import_id
          where ps.player_id=p.id
            and i.save_id=p_save_id
            and i.file_type='intake'
            and i.status='imported'
            and i.snapshot_date >= v_latest_squad_date
        )
      );
  else
    with latest as (
      select max(snapshot_date) as snapshot_date
      from imports
      where save_id=p_save_id and file_type in ('squad','intake') and status='imported'
    )
    update players p
    set is_active=true,updated_at=now()
    where p.save_id=p_save_id
      and exists(
        select 1
        from player_snapshots ps
        join imports i on i.id=ps.import_id
        cross join latest l
        where ps.player_id=p.id
          and i.snapshot_date=l.snapshot_date
          and i.file_type in ('squad','intake')
          and i.status='imported'
      );
  end if;

  return jsonb_build_object('deleted',true,'import_id',p_import_id);
end
$$;

insert into storage.buckets(id,name,public,file_size_limit)
values('fm-reader-samples','fm-reader-samples',false,209715200)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit;

create table if not exists public.fm_reader_samples(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  save_id uuid not null references public.saves(id) on delete cascade,
  fm_path text,
  csv_path text,
  comparison jsonb not null default '{}'::jsonb,
  parser_version text not null default 'offline-v0.22',
  created_at timestamptz not null default now()
);

alter table public.fm_reader_samples
  add column if not exists status text not null default 'uploading',
  add column if not exists expires_at timestamptz not null default (now() + interval '30 days'),
  add column if not exists storage_prefix text generated always as (owner_id::text || '/' || id::text) stored;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='fm_reader_samples_status_check'
      and conrelid='public.fm_reader_samples'::regclass
  ) then
    alter table public.fm_reader_samples
      add constraint fm_reader_samples_status_check
      check(status in ('uploading','complete','failed'));
  end if;
  if not exists(
    select 1 from pg_constraint
    where conname='fm_reader_samples_save_owner_fkey'
      and conrelid='public.fm_reader_samples'::regclass
  ) then
    alter table public.fm_reader_samples
      add constraint fm_reader_samples_save_owner_fkey
      foreign key(save_id,owner_id)
      references public.saves(id,owner_id)
      on delete cascade;
  end if;
end
$$;

create unique index if not exists fm_reader_samples_storage_prefix_idx
  on public.fm_reader_samples(storage_prefix);
create index if not exists fm_reader_samples_owner_expires_idx
  on public.fm_reader_samples(owner_id,expires_at);

alter table public.fm_reader_samples enable row level security;
grant select,insert,update,delete on public.fm_reader_samples to authenticated;

drop policy if exists fm_reader_samples_owner on public.fm_reader_samples;
create policy fm_reader_samples_owner on public.fm_reader_samples
  for all to authenticated
  using(
    owner_id=(select auth.uid())
    and exists(
      select 1 from public.saves s
      where s.id=fm_reader_samples.save_id
        and s.owner_id=(select auth.uid())
    )
  )
  with check(
    owner_id=(select auth.uid())
    and exists(
      select 1 from public.saves s
      where s.id=fm_reader_samples.save_id
        and s.owner_id=(select auth.uid())
    )
  );

drop policy if exists fm_reader_samples_upload on storage.objects;
drop policy if exists fm_reader_samples_read on storage.objects;
drop policy if exists fm_reader_samples_delete on storage.objects;

create policy fm_reader_samples_upload on storage.objects
  for insert to authenticated
  with check(
    bucket_id='fm-reader-samples'
    and exists(
      select 1 from public.fm_reader_samples s
      where s.owner_id=(select auth.uid())
        and s.status='uploading'
        and name like s.storage_prefix || '/%'
    )
  );

create policy fm_reader_samples_read on storage.objects
  for select to authenticated
  using(
    bucket_id='fm-reader-samples'
    and exists(
      select 1 from public.fm_reader_samples s
      where s.owner_id=(select auth.uid())
        and name like s.storage_prefix || '/%'
    )
  );

create policy fm_reader_samples_delete on storage.objects
  for delete to authenticated
  using(
    bucket_id='fm-reader-samples'
    and exists(
      select 1 from public.fm_reader_samples s
      where s.owner_id=(select auth.uid())
        and name like s.storage_prefix || '/%'
    )
  );

create or replace function public.datatracker_schema_info()
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_import_rpc boolean := to_regprocedure('public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb)') is not null;
  v_delete_rpc boolean := to_regprocedure('public.delete_fm_import(uuid,uuid)') is not null;
  v_model_patch boolean := to_regprocedure('public.patch_scoring_model_config(uuid,text,text,jsonb)') is not null;
  v_projections boolean := to_regclass('public.player_projections') is not null;
  v_diag_table boolean := to_regclass('public.fm_reader_samples') is not null;
  v_diag_bucket boolean := exists(select 1 from storage.buckets where id='fm-reader-samples' and public=false);
  v_diag_reservation boolean := exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='fm_reader_samples' and column_name='storage_prefix'
  );
  v_features text[] := array['schema_version_marker'];
begin
  if v_import_rpc then v_features := array_append(v_features,'import_fm_export'); end if;
  if v_delete_rpc then v_features := array_append(v_features,'delete_fm_import'); end if;
  if v_model_patch then v_features := array_append(v_features,'patch_scoring_model_config'); end if;
  if v_projections then v_features := array_append(v_features,'player_projections_v1'); end if;
  if v_diag_table and v_diag_bucket and v_diag_reservation then v_features := array_append(v_features,'fm_reader_diagnostics_v2'); end if;

  return jsonb_build_object(
    'schema_version','202608280001',
    'app_version','0.26.7',
    'features',to_jsonb(v_features),
    'capabilities',jsonb_build_object(
      'import_rpc',v_import_rpc,
      'delete_import_rpc',v_delete_rpc,
      'model_config_patch',v_model_patch,
      'projections',v_projections,
      'diagnostics_table',v_diag_table,
      'diagnostics_bucket',v_diag_bucket,
      'diagnostics_reservations',v_diag_reservation,
      'diagnostics_upload',v_diag_table and v_diag_bucket and v_diag_reservation
    )
  );
end
$$;

notify pgrst,'reload schema';

-- FM DataTracker 0.47.0 — WC-C World Census persistence.
-- Adds private source/package storage, owner-scoped metadata, private staging,
-- idempotent protocol receipts and atomic ReaderRun promotion.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('fm-world-sources', 'fm-world-sources', false, 536870912),
  ('fm-world-state', 'fm-world-state', false, 16777216)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create table public.world_source_artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket text not null default 'fm-world-sources' check (storage_bucket = 'fm-world-sources'),
  storage_path text not null,
  byte_size bigint not null check (byte_size >= 0),
  original_filename text,
  internal_save_name text,
  game_build text,
  game_version text,
  created_at timestamptz not null default now(),
  unique (owner_id, sha256),
  unique (id, owner_id),
  unique (owner_id, storage_bucket, storage_path)
);

create table public.world_lineages (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  lineage_key text not null default 'default',
  representation_version text not null,
  parent_lineage_id uuid,
  status text not null default 'active' check (status in ('active','superseded','archived')),
  created_at timestamptz not null default now(),
  unique (save_id, lineage_key, representation_version),
  unique (id, owner_id),
  unique (id, save_id, owner_id),
  foreign key (save_id, owner_id) references public.saves(id, owner_id) on delete cascade,
  foreign key (parent_lineage_id, owner_id) references public.world_lineages(id, owner_id)
    on delete set null (parent_lineage_id)
);

create table public.world_checkpoints (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  lineage_id uuid not null,
  checkpoint_date date,
  checkpoint_precision text not null check (checkpoint_precision in ('day','year','unknown')),
  checkpoint_date_source text not null check (checkpoint_date_source in ('reader_confirmed','user_confirmed','unknown')),
  source_artifact_id uuid not null,
  canonical_reader_run_id uuid,
  created_at timestamptz not null default now(),
  unique (lineage_id, source_artifact_id, checkpoint_date, checkpoint_precision),
  unique (id, owner_id),
  unique (id, save_id, owner_id, lineage_id),
  foreign key (save_id, owner_id) references public.saves(id, owner_id) on delete cascade,
  foreign key (lineage_id, save_id, owner_id) references public.world_lineages(id, save_id, owner_id) on delete cascade,
  foreign key (source_artifact_id, owner_id) references public.world_source_artifacts(id, owner_id) on delete restrict
);

create table public.world_reader_runs (
  id uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null,
  save_id uuid not null,
  owner_id uuid not null,
  lineage_id uuid not null,
  protocol_run_id text not null,
  protocol_version text not null,
  message_budget_bytes integer not null check (message_budget_bytes between 32768 and 262144),
  planned_capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(planned_capabilities)='array'),
  reader_version text not null,
  decoder_catalog_hash text,
  output_contract_version text not null,
  representation_version text not null,
  status text not null default 'staging' check (status in ('staging','complete','failed','superseded')),
  logical_content_hash text,
  coverage_hash text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostics)='object'),
  unique (owner_id, protocol_run_id),
  unique (id, owner_id),
  unique (id, checkpoint_id, owner_id),
  unique (id, save_id, owner_id, lineage_id),
  foreign key (checkpoint_id, save_id, owner_id, lineage_id)
    references public.world_checkpoints(id, save_id, owner_id, lineage_id) on delete cascade
);

alter table public.world_checkpoints
  add constraint world_checkpoints_canonical_run_fkey
  foreign key (canonical_reader_run_id, id, owner_id)
  references public.world_reader_runs(id, checkpoint_id, owner_id)
  on delete set null (canonical_reader_run_id);

create table public.world_coverage_capabilities (
  reader_run_id uuid not null,
  owner_id uuid not null,
  capability_key text not null,
  subject_unit text not null,
  subject_scope jsonb not null check (jsonb_typeof(subject_scope)='object'),
  enumeration_status text not null check (enumeration_status in ('complete_for_scope','partial_known_grammar','unsupported','not_attempted')),
  subjects_evaluated integer not null check (subjects_evaluated >= 0),
  confirmed_count integer not null check (confirmed_count >= 0),
  unknown_count integer not null check (unknown_count >= 0),
  ambiguous_count integer not null check (ambiguous_count >= 0),
  unsupported_count integer not null check (unsupported_count >= 0),
  excluded_count integer not null check (excluded_count >= 0),
  reason_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(reason_counts)='object'),
  coverage_ratio double precision,
  primary key (reader_run_id, capability_key),
  foreign key (reader_run_id, owner_id) references public.world_reader_runs(id, owner_id) on delete cascade,
  check (confirmed_count + unknown_count + ambiguous_count + unsupported_count + excluded_count = subjects_evaluated),
  check (coverage_ratio is null or (enumeration_status='complete_for_scope' and coverage_ratio between 0 and 1))
);

create table public.world_state_packages (
  id uuid primary key default gen_random_uuid(),
  reader_run_id uuid not null,
  save_id uuid not null,
  owner_id uuid not null,
  lineage_id uuid not null,
  package_kind text not null check (package_kind in ('full_anchor','anchor_overlay')),
  base_anchor_package_id uuid,
  format_version text not null,
  codec text not null,
  representation_version text not null,
  logical_content_hash text not null check (logical_content_hash ~ '^[0-9a-f]{64}$'),
  package_hash text not null check (package_hash ~ '^[0-9a-f]{64}$'),
  compressed_bytes bigint not null check (compressed_bytes >= 0),
  uncompressed_bytes bigint not null check (uncompressed_bytes >= 0),
  overlay_full_ratio double precision not null check (overlay_full_ratio >= 0),
  read_amplification double precision not null check (read_amplification >= 0),
  domain_actions jsonb not null default '{}'::jsonb check (jsonb_typeof(domain_actions)='object'),
  domain_hashes jsonb not null default '{}'::jsonb check (jsonb_typeof(domain_hashes)='object'),
  domain_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(domain_counts)='object'),
  status text not null default 'staging' check (status in ('staging','complete','invalid')),
  created_at timestamptz not null default now(),
  unique (reader_run_id),
  unique (id, owner_id),
  foreign key (reader_run_id, save_id, owner_id, lineage_id)
    references public.world_reader_runs(id, save_id, owner_id, lineage_id) on delete cascade,
  foreign key (base_anchor_package_id, owner_id)
    references public.world_state_packages(id, owner_id)
    deferrable initially deferred,
  check ((package_kind='full_anchor' and base_anchor_package_id is null)
      or (package_kind='anchor_overlay' and base_anchor_package_id is not null))
);

create table public.world_state_segments (
  package_id uuid not null,
  owner_id uuid not null,
  domain_key text not null,
  ordinal integer not null check (ordinal >= 0),
  storage_bucket text not null default 'fm-world-state' check (storage_bucket='fm-world-state'),
  storage_path text not null,
  segment_hash text not null check (segment_hash ~ '^[0-9a-f]{64}$'),
  record_count integer not null check (record_count >= 0),
  compressed_bytes bigint not null check (compressed_bytes >= 0),
  uncompressed_bytes bigint not null check (uncompressed_bytes >= 0),
  codec text not null,
  schema_version text not null,
  primary key (package_id, domain_key, ordinal),
  unique (owner_id, storage_bucket, storage_path),
  foreign key (package_id, owner_id) references public.world_state_packages(id, owner_id) on delete cascade
);

create table private.world_run_batches (
  reader_run_id uuid not null,
  owner_id uuid not null,
  seq integer not null check (seq >= 0),
  message_kind text not null check (message_kind in ('run_begin','dictionary_batch','entity_batch','fact_batch','coverage_final','run_end')),
  batch_hash text not null check (batch_hash ~ '^[0-9a-f]{64}$'),
  byte_count integer not null check (byte_count > 0),
  item_count integer not null default 0 check (item_count >= 0),
  received_at timestamptz not null default now(),
  acked_at timestamptz,
  primary key (reader_run_id, seq),
  foreign key (reader_run_id, owner_id) references public.world_reader_runs(id, owner_id) on delete cascade
);

create table private.world_run_uploads (
  reader_run_id uuid not null,
  owner_id uuid not null,
  domain_key text not null,
  ordinal integer not null check (ordinal >= 0),
  storage_bucket text not null check (storage_bucket='fm-world-state'),
  storage_path text not null,
  segment_hash text not null check (segment_hash ~ '^[0-9a-f]{64}$'),
  record_count integer not null check (record_count >= 0),
  compressed_bytes bigint not null check (compressed_bytes >= 0),
  uncompressed_bytes bigint not null check (uncompressed_bytes >= 0),
  codec text not null,
  schema_version text not null,
  created_at timestamptz not null default now(),
  primary key (reader_run_id, domain_key, ordinal),
  unique (owner_id, storage_bucket, storage_path),
  foreign key (reader_run_id, owner_id) references public.world_reader_runs(id, owner_id) on delete cascade
);

create table private.world_persistence_policy (
  singleton boolean primary key default true check (singleton),
  overlay_full_max double precision not null check (overlay_full_max between 0 and 1),
  read_amplification_max double precision not null check (read_amplification_max >= 1),
  dependent_overlay_mass_multiplier double precision not null check (dependent_overlay_mass_multiplier > 0),
  updated_at timestamptz not null default now()
);

insert into private.world_persistence_policy(
  singleton,overlay_full_max,read_amplification_max,dependent_overlay_mass_multiplier
) values (true,0.70,1.60,2.0)
on conflict (singleton) do nothing;

create index world_source_artifacts_owner_idx on public.world_source_artifacts(owner_id, created_at desc);
create index world_lineages_owner_save_idx on public.world_lineages(owner_id, save_id, created_at desc);
create index world_checkpoints_owner_save_date_idx on public.world_checkpoints(owner_id, save_id, checkpoint_date desc);
create index world_checkpoints_source_idx on public.world_checkpoints(source_artifact_id);
create index world_reader_runs_owner_checkpoint_idx on public.world_reader_runs(owner_id, checkpoint_id, started_at desc);
create index world_reader_runs_lineage_status_idx on public.world_reader_runs(lineage_id, status, completed_at desc);
create index world_coverage_capabilities_owner_idx on public.world_coverage_capabilities(owner_id, capability_key);
create index world_state_packages_owner_lineage_idx on public.world_state_packages(owner_id, lineage_id, status, created_at desc);
create index world_state_packages_base_anchor_idx on public.world_state_packages(base_anchor_package_id) where base_anchor_package_id is not null;
create index world_state_segments_owner_idx on public.world_state_segments(owner_id, package_id);
create index world_run_batches_owner_idx on private.world_run_batches(owner_id, reader_run_id, seq);
create index world_run_uploads_owner_idx on private.world_run_uploads(owner_id, reader_run_id);

alter table public.world_source_artifacts enable row level security;
alter table public.world_lineages enable row level security;
alter table public.world_checkpoints enable row level security;
alter table public.world_reader_runs enable row level security;
alter table public.world_coverage_capabilities enable row level security;
alter table public.world_state_packages enable row level security;
alter table public.world_state_segments enable row level security;
alter table private.world_run_batches enable row level security;
alter table private.world_run_uploads enable row level security;

create policy world_source_artifacts_owner on public.world_source_artifacts for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_lineages_owner on public.world_lineages for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_checkpoints_owner on public.world_checkpoints for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_reader_runs_owner on public.world_reader_runs for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_coverage_capabilities_owner on public.world_coverage_capabilities for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_state_packages_owner on public.world_state_packages for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_state_segments_owner on public.world_state_segments for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_run_batches_owner on private.world_run_batches for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_run_uploads_owner on private.world_run_uploads for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));

revoke all on table public.world_source_artifacts, public.world_lineages, public.world_checkpoints,
  public.world_reader_runs, public.world_coverage_capabilities, public.world_state_packages,
  public.world_state_segments from anon;
grant select, insert, update, delete on table public.world_source_artifacts, public.world_lineages, public.world_checkpoints,
  public.world_reader_runs, public.world_coverage_capabilities, public.world_state_packages,
  public.world_state_segments to authenticated, service_role;
revoke all on table private.world_run_batches, private.world_run_uploads, private.world_persistence_policy from public, anon, authenticated;
grant select, insert, update, delete on table private.world_run_batches, private.world_run_uploads to authenticated, service_role;
grant select on table private.world_persistence_policy to authenticated, service_role;
grant insert, update, delete on table private.world_persistence_policy to service_role;

create policy world_sources_insert on storage.objects for insert to authenticated
  with check (bucket_id='fm-world-sources' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy world_sources_select on storage.objects for select to authenticated
  using (bucket_id='fm-world-sources' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy world_sources_delete on storage.objects for delete to authenticated
  using (bucket_id='fm-world-sources' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy world_state_insert on storage.objects for insert to authenticated
  with check (bucket_id='fm-world-state' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy world_state_select on storage.objects for select to authenticated
  using (bucket_id='fm-world-state' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy world_state_delete on storage.objects for delete to authenticated
  using (bucket_id='fm-world-state' and (storage.foldername(name))[1]=(select auth.uid())::text);

create or replace function public.world_census_begin(
  p_save_id uuid,
  p_source_sha text,
  p_source_path text,
  p_source_byte_size bigint,
  p_source_filename text,
  p_internal_save_name text,
  p_checkpoint_date date,
  p_checkpoint_precision text,
  p_checkpoint_date_source text,
  p_protocol_run_id text,
  p_protocol_version text,
  p_message_budget_bytes integer,
  p_planned_capabilities jsonb,
  p_reader_version text,
  p_output_contract_version text,
  p_representation_version text
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner uuid := auth.uid();
  v_source public.world_source_artifacts%rowtype;
  v_lineage public.world_lineages%rowtype;
  v_checkpoint public.world_checkpoints%rowtype;
  v_run public.world_reader_runs%rowtype;
  v_source_reused boolean := false;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  if p_source_sha is null or p_source_sha !~ '^[0-9a-f]{64}$' then raise exception 'world_census_invalid_source_hash'; end if;
  if p_source_path is null or split_part(p_source_path,'/',1) <> v_owner::text then raise exception 'world_census_invalid_source_path'; end if;
  if p_source_byte_size is null or p_source_byte_size < 0 then raise exception 'world_census_invalid_source_size'; end if;
  if p_checkpoint_precision not in ('day','year','unknown') then raise exception 'world_census_invalid_checkpoint_precision'; end if;
  if p_checkpoint_date_source not in ('reader_confirmed','user_confirmed','unknown') then raise exception 'world_census_invalid_checkpoint_date_source'; end if;
  if p_checkpoint_precision='day' and p_checkpoint_date is null then raise exception 'world_census_checkpoint_date_required'; end if;
  if nullif(p_protocol_run_id,'') is null or nullif(p_protocol_version,'') is null
    or p_message_budget_bytes not between 32768 and 262144 or jsonb_typeof(p_planned_capabilities) is distinct from 'array'
    or nullif(p_reader_version,'') is null or nullif(p_output_contract_version,'') is null or nullif(p_representation_version,'') is null then
    raise exception 'world_census_invalid_run_contract';
  end if;

  perform 1 from public.saves where id=p_save_id and owner_id=v_owner for update;
  if not found then raise exception 'world_census_save_not_found'; end if;

  -- Idempotent begin: a retried RPC for the same validated protocol run returns
  -- the existing staging/complete run instead of creating a second ReaderRun.
  select * into v_run from public.world_reader_runs
  where owner_id=v_owner and protocol_run_id=p_protocol_run_id;
  if found then
    select * into v_checkpoint from public.world_checkpoints where id=v_run.checkpoint_id and owner_id=v_owner;
    select * into v_source from public.world_source_artifacts where id=v_checkpoint.source_artifact_id and owner_id=v_owner;
    if v_run.save_id<>p_save_id or v_source.sha256<>p_source_sha or v_source.byte_size<>p_source_byte_size
      or v_checkpoint.checkpoint_date is distinct from p_checkpoint_date or v_checkpoint.checkpoint_precision<>p_checkpoint_precision
      or v_run.protocol_version<>p_protocol_version or v_run.message_budget_bytes<>p_message_budget_bytes
      or v_run.planned_capabilities<>p_planned_capabilities or v_run.reader_version<>p_reader_version
      or v_run.output_contract_version<>p_output_contract_version or v_run.representation_version<>p_representation_version then
      raise exception 'world_census_protocol_run_conflict';
    end if;
    return jsonb_build_object(
      'source_artifact_id',v_source.id,'source_reused',true,'source_bucket',v_source.storage_bucket,'source_path',v_source.storage_path,
      'lineage_id',v_run.lineage_id,'checkpoint_id',v_checkpoint.id,'reader_run_id',v_run.id,
      'previous_canonical_reader_run_id',v_checkpoint.canonical_reader_run_id,'already_started',true,'run_status',v_run.status
    );
  end if;

  select * into v_source from public.world_source_artifacts
  where owner_id=v_owner and sha256=p_source_sha;
  if found then
    v_source_reused := true;
    if v_source.byte_size <> p_source_byte_size then raise exception 'world_census_source_hash_size_conflict'; end if;
  else
    insert into public.world_source_artifacts(
      owner_id,sha256,storage_bucket,storage_path,byte_size,original_filename,internal_save_name
    ) values (
      v_owner,p_source_sha,'fm-world-sources',p_source_path,p_source_byte_size,p_source_filename,p_internal_save_name
    ) returning * into v_source;
  end if;

  select * into v_lineage from public.world_lineages
  where save_id=p_save_id and owner_id=v_owner and lineage_key='default' and representation_version=p_representation_version
  order by created_at asc limit 1;
  if not found then
    insert into public.world_lineages(save_id,owner_id,lineage_key,representation_version,status)
    values(p_save_id,v_owner,'default',p_representation_version,'active') returning * into v_lineage;
  end if;

  select * into v_checkpoint from public.world_checkpoints
  where lineage_id=v_lineage.id and source_artifact_id=v_source.id
    and checkpoint_date is not distinct from p_checkpoint_date
    and checkpoint_precision=p_checkpoint_precision
  order by created_at asc limit 1;
  if not found then
    insert into public.world_checkpoints(save_id,owner_id,lineage_id,checkpoint_date,checkpoint_precision,checkpoint_date_source,source_artifact_id)
    values(p_save_id,v_owner,v_lineage.id,p_checkpoint_date,p_checkpoint_precision,p_checkpoint_date_source,v_source.id)
    returning * into v_checkpoint;
  else
    if v_checkpoint.checkpoint_date_source='user_confirmed' and p_checkpoint_date_source='reader_confirmed' then
      update public.world_checkpoints set checkpoint_date_source='reader_confirmed' where id=v_checkpoint.id returning * into v_checkpoint;
    end if;
  end if;

  insert into public.world_reader_runs(
    checkpoint_id,save_id,owner_id,lineage_id,protocol_run_id,protocol_version,message_budget_bytes,planned_capabilities,
    reader_version,output_contract_version,representation_version,status
  ) values (
    v_checkpoint.id,p_save_id,v_owner,v_lineage.id,p_protocol_run_id,p_protocol_version,p_message_budget_bytes,p_planned_capabilities,
    p_reader_version,p_output_contract_version,p_representation_version,'staging'
  ) returning * into v_run;

  return jsonb_build_object(
    'source_artifact_id',v_source.id,
    'source_reused',v_source_reused,
    'source_bucket',v_source.storage_bucket,
    'source_path',v_source.storage_path,
    'lineage_id',v_lineage.id,
    'checkpoint_id',v_checkpoint.id,
    'reader_run_id',v_run.id,
    'previous_canonical_reader_run_id',v_checkpoint.canonical_reader_run_id
  );
end
$$;

create or replace function public.world_census_record_batch_receipts(
  p_reader_run_id uuid,
  p_receipts jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner uuid := auth.uid();
  v_receipt jsonb;
  v_existing private.world_run_batches%rowtype;
  v_expected integer;
  v_seq integer;
  v_kind text;
  v_hash text;
  v_bytes integer;
  v_items integer;
  v_inserted integer := 0;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  if jsonb_typeof(p_receipts) is distinct from 'array' then raise exception 'world_census_invalid_receipts'; end if;
  perform 1 from public.world_reader_runs where id=p_reader_run_id and owner_id=v_owner and status='staging' for update;
  if not found then raise exception 'world_census_run_not_staging'; end if;

  select coalesce(max(seq)+1,0) into v_expected from private.world_run_batches
  where reader_run_id=p_reader_run_id and owner_id=v_owner;

  for v_receipt in select value from jsonb_array_elements(p_receipts) loop
    v_seq := (v_receipt->>'seq')::integer;
    v_kind := v_receipt->>'message_kind';
    v_hash := v_receipt->>'batch_hash';
    v_bytes := (v_receipt->>'byte_count')::integer;
    v_items := coalesce((v_receipt->>'item_count')::integer,0);
    if v_seq < 0 or v_kind not in ('run_begin','dictionary_batch','entity_batch','fact_batch','coverage_final','run_end')
      or v_hash !~ '^[0-9a-f]{64}$' or v_bytes <= 0 or v_items < 0 then
      raise exception 'world_census_invalid_receipt';
    end if;
    select * into v_existing from private.world_run_batches
    where reader_run_id=p_reader_run_id and seq=v_seq;
    if found then
      if v_existing.batch_hash<>v_hash or v_existing.message_kind<>v_kind or v_existing.byte_count<>v_bytes or v_existing.item_count<>v_items then
        raise exception 'world_census_receipt_conflict:%',v_seq;
      end if;
      continue;
    end if;
    if v_seq<>v_expected then raise exception 'world_census_receipt_gap:%->%',v_expected,v_seq; end if;
    insert into private.world_run_batches(reader_run_id,owner_id,seq,message_kind,batch_hash,byte_count,item_count,acked_at)
    values(p_reader_run_id,v_owner,v_seq,v_kind,v_hash,v_bytes,v_items,now());
    v_expected := v_expected + 1;
    v_inserted := v_inserted + 1;
  end loop;
  return jsonb_build_object('inserted',v_inserted,'next_seq',v_expected);
end
$$;

create or replace function public.world_census_stage_segments(
  p_reader_run_id uuid,
  p_segments jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner uuid := auth.uid();
  v_segment jsonb;
  v_existing private.world_run_uploads%rowtype;
  v_inserted integer := 0;
  v_domain text;
  v_ordinal integer;
  v_bucket text;
  v_path text;
  v_hash text;
  v_records integer;
  v_compressed bigint;
  v_uncompressed bigint;
  v_codec text;
  v_schema text;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  if jsonb_typeof(p_segments) is distinct from 'array' then raise exception 'world_census_invalid_segments'; end if;
  perform 1 from public.world_reader_runs where id=p_reader_run_id and owner_id=v_owner and status='staging' for update;
  if not found then raise exception 'world_census_run_not_staging'; end if;

  for v_segment in select value from jsonb_array_elements(p_segments) loop
    v_domain := v_segment->>'domain_key';
    v_ordinal := (v_segment->>'ordinal')::integer;
    v_bucket := v_segment->>'storage_bucket';
    v_path := v_segment->>'storage_path';
    v_hash := v_segment->>'segment_hash';
    v_records := (v_segment->>'record_count')::integer;
    v_compressed := (v_segment->>'compressed_bytes')::bigint;
    v_uncompressed := (v_segment->>'uncompressed_bytes')::bigint;
    v_codec := v_segment->>'codec';
    v_schema := v_segment->>'schema_version';
    if nullif(v_domain,'') is null or v_ordinal<0 or v_bucket<>'fm-world-state'
      or split_part(v_path,'/',1)<>v_owner::text or v_hash !~ '^[0-9a-f]{64}$'
      or v_records<0 or v_compressed<0 or v_uncompressed<0 or nullif(v_codec,'') is null or nullif(v_schema,'') is null then
      raise exception 'world_census_invalid_segment';
    end if;
    select * into v_existing from private.world_run_uploads
    where reader_run_id=p_reader_run_id and domain_key=v_domain and ordinal=v_ordinal;
    if found then
      if v_existing.storage_bucket<>v_bucket or v_existing.storage_path<>v_path or v_existing.segment_hash<>v_hash
        or v_existing.record_count<>v_records or v_existing.compressed_bytes<>v_compressed
        or v_existing.uncompressed_bytes<>v_uncompressed or v_existing.codec<>v_codec or v_existing.schema_version<>v_schema then
        raise exception 'world_census_segment_conflict:%:%',v_domain,v_ordinal;
      end if;
      continue;
    end if;
    insert into private.world_run_uploads(
      reader_run_id,owner_id,domain_key,ordinal,storage_bucket,storage_path,segment_hash,
      record_count,compressed_bytes,uncompressed_bytes,codec,schema_version
    ) values (
      p_reader_run_id,v_owner,v_domain,v_ordinal,v_bucket,v_path,v_hash,
      v_records,v_compressed,v_uncompressed,v_codec,v_schema
    );
    v_inserted := v_inserted + 1;
  end loop;
  return jsonb_build_object('inserted',v_inserted);
end
$$;

create or replace function public.world_census_finalize(
  p_reader_run_id uuid,
  p_coverage_manifest jsonb,
  p_coverage_hash text,
  p_run_end jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner uuid := auth.uid();
  v_run public.world_reader_runs%rowtype;
  v_checkpoint public.world_checkpoints%rowtype;
  v_anchor public.world_state_packages%rowtype;
  v_package public.world_state_packages%rowtype;
  v_cap jsonb;
  v_counts jsonb;
  v_domain_counts jsonb;
  v_domain_hashes jsonb;
  v_domain_actions jsonb := '{}'::jsonb;
  v_domain text;
  v_domains text[] := array[
    'evidence_refs','derivation_refs','person_records','structural_team_facts','organization_scope_facts',
    'player_core_facts','biography_facts','organization_scope_containment','contract_facts',
    'active_relationship_facts','club_affiliation_facts'
  ];
  v_expected_count bigint;
  v_staged_count bigint;
  v_full_compressed bigint;
  v_full_uncompressed bigint;
  v_overlay_compressed bigint := 0;
  v_overlay_uncompressed bigint := 0;
  v_anchor_overlay_mass bigint := 0;
  v_overlay_ratio double precision := 0;
  v_read_amp double precision := 1;
  v_overlay_full_max double precision;
  v_read_amp_max double precision;
  v_overlay_mass_multiplier double precision;
  v_kind text := 'full_anchor';
  v_base_anchor uuid := null;
  v_old_canonical uuid;
  v_package_hash text;
  v_decoder_hash text;
  v_max_seq integer;
  v_receipt_count integer;
  v_last_kind text;
  v_coverage_receipts integer;
  v_run_end_receipts integer;
  v_discard_paths jsonb;
  v_reason_counts jsonb;
  v_subjects integer;
  v_confirmed integer;
  v_unknown integer;
  v_ambiguous integer;
  v_unsupported integer;
  v_excluded integer;
  v_enum text;
  v_ratio double precision;
  v_expected_capabilities jsonb;
  v_final_capabilities jsonb;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  if p_coverage_hash !~ '^[0-9a-f]{64}$' then raise exception 'world_census_invalid_coverage_hash'; end if;
  if jsonb_typeof(p_coverage_manifest) is distinct from 'object'
    or p_coverage_manifest->>'version' is distinct from 'world-coverage-manifest-v1'
    or jsonb_typeof(p_coverage_manifest->'capabilities') is distinct from 'array' then
    raise exception 'world_census_invalid_coverage_manifest';
  end if;
  if jsonb_typeof(p_run_end) is distinct from 'object' or p_run_end->>'type' is distinct from 'run_end' then
    raise exception 'world_census_invalid_run_end';
  end if;

  select overlay_full_max,read_amplification_max,dependent_overlay_mass_multiplier
  into v_overlay_full_max,v_read_amp_max,v_overlay_mass_multiplier
  from private.world_persistence_policy where singleton=true;
  if not found then raise exception 'world_census_persistence_policy_missing'; end if;

  select * into v_run from public.world_reader_runs
  where id=p_reader_run_id and owner_id=v_owner for update;
  if not found then raise exception 'world_census_run_not_found'; end if;
  if p_run_end->>'run_id' is distinct from v_run.protocol_run_id then raise exception 'world_census_run_id_conflict'; end if;
  if v_run.status='complete' then
    if v_run.logical_content_hash is distinct from p_run_end->>'logical_hash' or v_run.coverage_hash is distinct from p_coverage_hash then
      raise exception 'world_census_finalize_replay_conflict';
    end if;
    select * into v_package from public.world_state_packages where reader_run_id=v_run.id and owner_id=v_owner and status='complete';
    if not found then raise exception 'world_census_complete_package_missing'; end if;
    select * into v_checkpoint from public.world_checkpoints where id=v_run.checkpoint_id and owner_id=v_owner;
    return jsonb_build_object(
      'reader_run_id',v_run.id,'checkpoint_id',v_checkpoint.id,'package_id',v_package.id,
      'package_kind',v_package.package_kind,'base_anchor_package_id',v_package.base_anchor_package_id,
      'package_hash',v_package.package_hash,'compressed_bytes',v_package.compressed_bytes,
      'uncompressed_bytes',v_package.uncompressed_bytes,'overlay_full_ratio',v_package.overlay_full_ratio,
      'read_amplification',v_package.read_amplification,'discard_paths','[]'::jsonb,'already_complete',true
    );
  end if;
  if v_run.status<>'staging' then raise exception 'world_census_run_not_staging'; end if;
  if p_run_end->>'coverage_hash' is distinct from p_coverage_hash then raise exception 'world_census_coverage_hash_conflict'; end if;
  if (p_run_end->>'logical_hash') !~ '^[0-9a-f]{64}$' then raise exception 'world_census_invalid_logical_hash'; end if;
  if jsonb_typeof(p_run_end->'domain_counts') is distinct from 'object' or jsonb_typeof(p_run_end->'domain_hashes') is distinct from 'object' then
    raise exception 'world_census_invalid_domain_manifest';
  end if;
  v_domain_counts := p_run_end->'domain_counts';
  v_domain_hashes := p_run_end->'domain_hashes';

  select coalesce(jsonb_agg(value order by value),'[]'::jsonb) into v_expected_capabilities
  from jsonb_array_elements_text(v_run.planned_capabilities);
  select coalesce(jsonb_agg(value order by value),'[]'::jsonb) into v_final_capabilities
  from (select item->>'capability_key' as value from jsonb_array_elements(p_coverage_manifest->'capabilities') item) q;
  if v_expected_capabilities<>v_final_capabilities then raise exception 'world_census_coverage_capability_mismatch'; end if;

  select count(*), max(seq) into v_receipt_count,v_max_seq
  from private.world_run_batches where reader_run_id=p_reader_run_id and owner_id=v_owner;
  if v_receipt_count=0 or v_max_seq is null or v_receipt_count<>v_max_seq+1 then raise exception 'world_census_receipts_not_contiguous'; end if;
  select message_kind into v_last_kind from private.world_run_batches
  where reader_run_id=p_reader_run_id and seq=v_max_seq;
  if v_last_kind<>'run_end' then raise exception 'world_census_run_end_receipt_required'; end if;
  if not exists(select 1 from private.world_run_batches where reader_run_id=p_reader_run_id and seq=0 and message_kind='run_begin') then
    raise exception 'world_census_run_begin_receipt_required';
  end if;
  select count(*) into v_coverage_receipts from private.world_run_batches where reader_run_id=p_reader_run_id and message_kind='coverage_final';
  select count(*) into v_run_end_receipts from private.world_run_batches where reader_run_id=p_reader_run_id and message_kind='run_end';
  if v_coverage_receipts<>1 or v_run_end_receipts<>1 then raise exception 'world_census_terminal_receipt_conflict'; end if;

  foreach v_domain in array v_domains loop
    v_expected_count := coalesce((v_domain_counts->>v_domain)::bigint,0);
    select coalesce(sum(record_count),0) into v_staged_count
    from private.world_run_uploads where reader_run_id=p_reader_run_id and owner_id=v_owner and domain_key=v_domain;
    if v_staged_count<>v_expected_count then
      raise exception 'world_census_segment_count_mismatch:%:%<>%',v_domain,v_staged_count,v_expected_count;
    end if;
    if v_expected_count>0 and (v_domain_hashes->>v_domain) !~ '^[0-9a-f]{64}$' then
      raise exception 'world_census_domain_hash_missing:%',v_domain;
    end if;
  end loop;
  if exists(select 1 from private.world_run_uploads u where u.reader_run_id=p_reader_run_id and not (u.domain_key=any(v_domains))) then
    raise exception 'world_census_unknown_staged_domain';
  end if;

  select * into v_checkpoint from public.world_checkpoints
  where id=v_run.checkpoint_id and owner_id=v_owner for update;
  if not found then raise exception 'world_census_checkpoint_not_found'; end if;
  if not exists(
    select 1 from public.world_source_artifacts s
    join storage.objects o on o.bucket_id=s.storage_bucket and o.name=s.storage_path
    where s.id=v_checkpoint.source_artifact_id and s.owner_id=v_owner
  ) then raise exception 'world_census_source_object_missing'; end if;
  if exists(
    select 1 from private.world_run_uploads u
    left join storage.objects o on o.bucket_id=u.storage_bucket and o.name=u.storage_path
    where u.reader_run_id=p_reader_run_id and u.owner_id=v_owner and o.id is null
  ) then raise exception 'world_census_segment_object_missing'; end if;

  select p.* into v_anchor
  from public.world_state_packages p
  join public.world_reader_runs r on r.id=p.reader_run_id and r.owner_id=p.owner_id
  join public.world_checkpoints c on c.id=r.checkpoint_id and c.owner_id=r.owner_id
  where p.owner_id=v_owner and p.lineage_id=v_run.lineage_id and p.status='complete'
    and p.package_kind='full_anchor' and p.representation_version=v_run.representation_version
    and c.id<>v_checkpoint.id
    and (v_checkpoint.checkpoint_date is null or c.checkpoint_date is null or c.checkpoint_date<=v_checkpoint.checkpoint_date)
  order by c.checkpoint_date desc nulls last, p.created_at desc
  limit 1;

  select coalesce(sum(compressed_bytes),0),coalesce(sum(uncompressed_bytes),0)
  into v_full_compressed,v_full_uncompressed
  from private.world_run_uploads where reader_run_id=p_reader_run_id and owner_id=v_owner;

  foreach v_domain in array v_domains loop
    if v_anchor.id is not null and coalesce(v_domain_hashes->>v_domain,'')<>'' and (v_anchor.domain_hashes->>v_domain)=(v_domain_hashes->>v_domain) then
      v_domain_actions := v_domain_actions || jsonb_build_object(v_domain,'inherit');
    elsif coalesce((v_domain_counts->>v_domain)::bigint,0)>0 then
      v_domain_actions := v_domain_actions || jsonb_build_object(v_domain,'replace');
      select v_overlay_compressed+coalesce(sum(compressed_bytes),0),v_overlay_uncompressed+coalesce(sum(uncompressed_bytes),0)
      into v_overlay_compressed,v_overlay_uncompressed
      from private.world_run_uploads where reader_run_id=p_reader_run_id and owner_id=v_owner and domain_key=v_domain;
    else
      v_domain_actions := v_domain_actions || jsonb_build_object(v_domain,'mask');
    end if;
  end loop;

  if v_anchor.id is not null then
    if v_full_compressed>0 then
      v_overlay_ratio := v_overlay_compressed::double precision/v_full_compressed::double precision;
      v_read_amp := (v_anchor.compressed_bytes+v_overlay_compressed)::double precision/v_full_compressed::double precision;
    elsif v_overlay_compressed=0 then
      v_overlay_ratio := 0; v_read_amp := 1;
    else
      v_overlay_ratio := 1; v_read_amp := 999;
    end if;
    select coalesce(sum(compressed_bytes),0) into v_anchor_overlay_mass
    from public.world_state_packages
    where owner_id=v_owner and base_anchor_package_id=v_anchor.id and status='complete' and package_kind='anchor_overlay';
    if v_overlay_ratio<=v_overlay_full_max and v_read_amp<=v_read_amp_max
      and (v_anchor.compressed_bytes=0 or v_anchor_overlay_mass+v_overlay_compressed < v_overlay_mass_multiplier*v_anchor.compressed_bytes) then
      v_kind := 'anchor_overlay';
      v_base_anchor := v_anchor.id;
    end if;
  end if;

  if v_kind='full_anchor' then
    v_base_anchor := null;
    v_overlay_ratio := 1;
    v_read_amp := 1;
    v_overlay_compressed := v_full_compressed;
    v_overlay_uncompressed := v_full_uncompressed;
    v_domain_actions := '{}'::jsonb;
    foreach v_domain in array v_domains loop
      if coalesce((v_domain_counts->>v_domain)::bigint,0)>0 then
        v_domain_actions := v_domain_actions || jsonb_build_object(v_domain,'replace');
      else
        v_domain_actions := v_domain_actions || jsonb_build_object(v_domain,'mask');
      end if;
    end loop;
  end if;

  v_package_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'format_version','world-state-package-v1',
    'representation_version',v_run.representation_version,
    'logical_content_hash',p_run_end->>'logical_hash',
    'coverage_hash',p_coverage_hash,
    'package_kind',v_kind,
    'base_anchor_package_id',v_base_anchor,
    'domain_actions',v_domain_actions,
    'domain_hashes',v_domain_hashes,
    'domain_counts',v_domain_counts,
    'segments',(select coalesce(jsonb_agg(jsonb_build_object(
      'domain_key',u.domain_key,'ordinal',u.ordinal,'segment_hash',u.segment_hash,
      'record_count',u.record_count,'compressed_bytes',u.compressed_bytes,'uncompressed_bytes',u.uncompressed_bytes,
      'codec',u.codec,'schema_version',u.schema_version
    ) order by u.domain_key,u.ordinal),'[]'::jsonb)
      from private.world_run_uploads u
      where u.reader_run_id=p_reader_run_id and u.owner_id=v_owner
        and (v_kind='full_anchor' or v_domain_actions->>u.domain_key='replace'))
  )::text,'utf8'),'sha256'),'hex');

  insert into public.world_state_packages(
    reader_run_id,save_id,owner_id,lineage_id,package_kind,base_anchor_package_id,format_version,codec,
    representation_version,logical_content_hash,package_hash,compressed_bytes,uncompressed_bytes,overlay_full_ratio,read_amplification,
    domain_actions,domain_hashes,domain_counts,status
  ) values (
    v_run.id,v_run.save_id,v_owner,v_run.lineage_id,v_kind,v_base_anchor,'world-state-package-v1','gzip-json-v1',
    v_run.representation_version,p_run_end->>'logical_hash',v_package_hash,v_overlay_compressed,v_overlay_uncompressed,v_overlay_ratio,v_read_amp,
    v_domain_actions,v_domain_hashes,v_domain_counts,'complete'
  ) returning * into v_package;

  insert into public.world_state_segments(
    package_id,owner_id,domain_key,ordinal,storage_bucket,storage_path,segment_hash,record_count,
    compressed_bytes,uncompressed_bytes,codec,schema_version
  )
  select v_package.id,v_owner,u.domain_key,u.ordinal,u.storage_bucket,u.storage_path,u.segment_hash,u.record_count,
    u.compressed_bytes,u.uncompressed_bytes,u.codec,u.schema_version
  from private.world_run_uploads u
  where u.reader_run_id=p_reader_run_id and u.owner_id=v_owner
    and (v_kind='full_anchor' or v_domain_actions->>u.domain_key='replace')
  order by u.domain_key,u.ordinal;

  for v_cap in select value from jsonb_array_elements(p_coverage_manifest->'capabilities') loop
    if nullif(v_cap->>'capability_key','') is null or nullif(v_cap->>'subject_unit','') is null
      or jsonb_typeof(v_cap->'subject_scope') is distinct from 'object' or jsonb_typeof(v_cap->'counts') is distinct from 'object'
      or jsonb_typeof(v_cap->'reason_counts') is distinct from 'object' then
      raise exception 'world_census_invalid_coverage_capability';
    end if;
    v_counts := v_cap->'counts';
    v_reason_counts := v_cap->'reason_counts';
    v_subjects := (v_cap->>'subjects_evaluated')::integer;
    v_confirmed := coalesce((v_counts->>'confirmed')::integer,0);
    v_unknown := coalesce((v_counts->>'unknown')::integer,0);
    v_ambiguous := coalesce((v_counts->>'ambiguous')::integer,0);
    v_unsupported := coalesce((v_counts->>'unsupported')::integer,0);
    v_excluded := coalesce((v_counts->>'excluded')::integer,0);
    v_enum := v_cap->'subject_scope'->>'enumeration_status';
    v_ratio := case when v_cap->'coverage_ratio' is null or v_cap->'coverage_ratio'='null'::jsonb then null else (v_cap->>'coverage_ratio')::double precision end;
    if v_subjects<0 or v_confirmed+v_unknown+v_ambiguous+v_unsupported+v_excluded<>v_subjects
      or v_enum not in ('complete_for_scope','partial_known_grammar','unsupported','not_attempted')
      or (v_ratio is not null and (v_enum<>'complete_for_scope' or v_ratio<0 or v_ratio>1)) then
      raise exception 'world_census_invalid_coverage_counts:%',v_cap->>'capability_key';
    end if;
    insert into public.world_coverage_capabilities(
      reader_run_id,owner_id,capability_key,subject_unit,subject_scope,enumeration_status,subjects_evaluated,
      confirmed_count,unknown_count,ambiguous_count,unsupported_count,excluded_count,reason_counts,coverage_ratio
    ) values (
      v_run.id,v_owner,v_cap->>'capability_key',v_cap->>'subject_unit',v_cap->'subject_scope',v_enum,v_subjects,
      v_confirmed,v_unknown,v_ambiguous,v_unsupported,v_excluded,v_reason_counts,v_ratio
    );
  end loop;

  v_decoder_hash := encode(extensions.digest(convert_to(coalesce(p_run_end->'decoder_catalog','[]'::jsonb)::text,'utf8'),'sha256'),'hex');
  v_old_canonical := v_checkpoint.canonical_reader_run_id;
  if v_old_canonical is not null and v_old_canonical<>v_run.id then
    update public.world_reader_runs set status='superseded'
    where id=v_old_canonical and owner_id=v_owner and status='complete';
  end if;

  update public.world_reader_runs set
    decoder_catalog_hash=v_decoder_hash,
    status='complete',
    logical_content_hash=p_run_end->>'logical_hash',
    coverage_hash=p_coverage_hash,
    completed_at=now(),
    diagnostics=coalesce(p_run_end->'diagnostics','{}'::jsonb)
  where id=v_run.id and owner_id=v_owner;

  update public.world_checkpoints set canonical_reader_run_id=v_run.id
  where id=v_checkpoint.id and owner_id=v_owner;

  select coalesce(jsonb_agg(storage_path order by storage_path),'[]'::jsonb) into v_discard_paths
  from private.world_run_uploads u
  where u.reader_run_id=p_reader_run_id and u.owner_id=v_owner
    and not (v_kind='full_anchor' or v_domain_actions->>u.domain_key='replace');

  delete from private.world_run_batches where reader_run_id=p_reader_run_id and owner_id=v_owner;
  delete from private.world_run_uploads where reader_run_id=p_reader_run_id and owner_id=v_owner;

  return jsonb_build_object(
    'reader_run_id',v_run.id,
    'checkpoint_id',v_checkpoint.id,
    'package_id',v_package.id,
    'package_kind',v_kind,
    'base_anchor_package_id',v_base_anchor,
    'package_hash',v_package_hash,
    'compressed_bytes',v_overlay_compressed,
    'uncompressed_bytes',v_overlay_uncompressed,
    'overlay_full_ratio',v_overlay_ratio,
    'read_amplification',v_read_amp,
    'discard_paths',v_discard_paths
  );
end
$$;

create or replace function public.world_census_fail(
  p_reader_run_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner uuid := auth.uid();
  v_paths jsonb;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  perform 1 from public.world_reader_runs where id=p_reader_run_id and owner_id=v_owner and status='staging' for update;
  if not found then
    return jsonb_build_object('changed',false,'discard_paths','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(storage_path order by storage_path),'[]'::jsonb) into v_paths
  from private.world_run_uploads where reader_run_id=p_reader_run_id and owner_id=v_owner;
  update public.world_reader_runs set status='failed',completed_at=now(),diagnostics=diagnostics||jsonb_build_object('persistence_failure',coalesce(nullif(p_reason,''),'unknown'))
  where id=p_reader_run_id and owner_id=v_owner;
  delete from private.world_run_batches where reader_run_id=p_reader_run_id and owner_id=v_owner;
  delete from private.world_run_uploads where reader_run_id=p_reader_run_id and owner_id=v_owner;
  return jsonb_build_object('changed',true,'discard_paths',v_paths);
end
$$;

create or replace function private.world_census_gc_source_artifact_after_checkpoint_delete()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  delete from public.world_source_artifacts s
  where s.id=old.source_artifact_id and s.owner_id=old.owner_id
    and not exists(select 1 from public.world_checkpoints c where c.source_artifact_id=s.id);
  return old;
end
$$;
revoke all on function private.world_census_gc_source_artifact_after_checkpoint_delete() from public, anon, authenticated;

drop trigger if exists world_census_gc_source_artifact_after_checkpoint_delete on public.world_checkpoints;
create trigger world_census_gc_source_artifact_after_checkpoint_delete
after delete on public.world_checkpoints
for each row execute function private.world_census_gc_source_artifact_after_checkpoint_delete();

create or replace function public.world_census_collect_save_storage(
  p_save_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner uuid := auth.uid();
  v_state_paths jsonb;
  v_source_paths jsonb;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  perform 1 from public.saves where id=p_save_id and owner_id=v_owner;
  if not found then raise exception 'world_census_save_not_found'; end if;

  select coalesce(jsonb_agg(storage_path order by storage_path),'[]'::jsonb) into v_state_paths
  from (
    select distinct s.storage_path
    from public.world_state_segments s
    join public.world_state_packages p on p.id=s.package_id and p.owner_id=s.owner_id
    join public.world_reader_runs r on r.id=p.reader_run_id and r.owner_id=p.owner_id
    where r.save_id=p_save_id and r.owner_id=v_owner
  ) q;

  select coalesce(jsonb_agg(storage_path order by storage_path),'[]'::jsonb) into v_source_paths
  from (
    select distinct a.storage_path
    from public.world_source_artifacts a
    where a.owner_id=v_owner
      and exists(select 1 from public.world_checkpoints c where c.source_artifact_id=a.id and c.save_id=p_save_id and c.owner_id=v_owner)
      and not exists(select 1 from public.world_checkpoints c where c.source_artifact_id=a.id and c.save_id<>p_save_id)
  ) q;

  return jsonb_build_object('state_paths',v_state_paths,'source_paths',v_source_paths);
end
$$;

create or replace function public.world_census_delete_checkpoint(
  p_checkpoint_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner uuid := auth.uid();
  v_checkpoint public.world_checkpoints%rowtype;
  v_source public.world_source_artifacts%rowtype;
  v_paths jsonb;
  v_source_deleted boolean := false;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  select * into v_checkpoint from public.world_checkpoints where id=p_checkpoint_id and owner_id=v_owner for update;
  if not found then raise exception 'world_census_checkpoint_not_found'; end if;
  if exists(
    select 1 from public.world_state_packages child
    join public.world_state_packages anchor on anchor.id=child.base_anchor_package_id and anchor.owner_id=child.owner_id
    join public.world_reader_runs r on r.id=anchor.reader_run_id and r.owner_id=anchor.owner_id
    where r.checkpoint_id=v_checkpoint.id and child.status='complete'
      and child.reader_run_id not in (select id from public.world_reader_runs where checkpoint_id=v_checkpoint.id)
  ) then raise exception 'world_census_checkpoint_is_required_anchor'; end if;

  select coalesce(jsonb_agg(s.storage_path order by s.storage_path),'[]'::jsonb) into v_paths
  from public.world_state_segments s
  join public.world_state_packages p on p.id=s.package_id and p.owner_id=s.owner_id
  join public.world_reader_runs r on r.id=p.reader_run_id and r.owner_id=p.owner_id
  where r.checkpoint_id=v_checkpoint.id and r.owner_id=v_owner;

  select * into v_source from public.world_source_artifacts where id=v_checkpoint.source_artifact_id and owner_id=v_owner;
  delete from public.world_checkpoints where id=v_checkpoint.id and owner_id=v_owner;
  if v_source.id is not null and not exists(select 1 from public.world_checkpoints where source_artifact_id=v_source.id) then
    delete from public.world_source_artifacts where id=v_source.id and owner_id=v_owner;
    v_source_deleted := true;
  end if;
  return jsonb_build_object(
    'deleted',true,
    'state_paths',v_paths,
    'source_deleted',v_source_deleted,
    'source_bucket',case when v_source_deleted then v_source.storage_bucket else null end,
    'source_path',case when v_source_deleted then v_source.storage_path else null end
  );
end
$$;

revoke all on function public.world_census_begin(uuid,text,text,bigint,text,text,date,text,text,text,text,integer,jsonb,text,text,text) from public, anon;
revoke all on function public.world_census_record_batch_receipts(uuid,jsonb) from public, anon;
revoke all on function public.world_census_stage_segments(uuid,jsonb) from public, anon;
revoke all on function public.world_census_finalize(uuid,jsonb,text,jsonb) from public, anon;
revoke all on function public.world_census_fail(uuid,text) from public, anon;
revoke all on function public.world_census_delete_checkpoint(uuid) from public, anon;
revoke all on function public.world_census_collect_save_storage(uuid) from public, anon;
grant execute on function public.world_census_begin(uuid,text,text,bigint,text,text,date,text,text,text,text,integer,jsonb,text,text,text) to authenticated;
grant execute on function public.world_census_record_batch_receipts(uuid,jsonb) to authenticated;
grant execute on function public.world_census_stage_segments(uuid,jsonb) to authenticated;
grant execute on function public.world_census_finalize(uuid,jsonb,text,jsonb) to authenticated;
grant execute on function public.world_census_fail(uuid,text) to authenticated;
grant execute on function public.world_census_delete_checkpoint(uuid) to authenticated;
grant execute on function public.world_census_collect_save_storage(uuid) to authenticated;

notify pgrst,'reload schema';

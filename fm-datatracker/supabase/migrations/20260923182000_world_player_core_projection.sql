-- FM DataTracker 0.49.0 — WC-E first consuming projection.
-- Materializes World Census player_core_facts for Player Evolution shadow reads.
-- Legacy players/player_snapshots/player_attributes remain the UI source of truth.

create table public.world_player_core_projection (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  save_id uuid not null,
  lineage_id uuid not null,
  checkpoint_id uuid not null,
  reader_run_id uuid not null,
  world_person_record_id uuid not null,
  person_entity_id uuid not null,
  identity_epoch_id uuid,
  person_record_ref integer not null check (person_record_ref > 0),
  uid bigint not null check (uid > 0),
  checkpoint_date date,
  is_canonical boolean not null default true,
  identity_linkage_status text not null check (identity_linkage_status in ('confirmed','unknown','ambiguous','unsupported','excluded')),
  identity_linkage_reason text not null,
  identity_birth_date date,
  core_status text not null check (core_status in ('confirmed','unknown','ambiguous','unsupported','excluded')),
  core_reason_code text not null,
  ca smallint,
  pa smallint,
  position_ratings smallint[],
  attributes_1_20 smallint[],
  height_cm smallint,
  evidence_refs integer[] not null,
  derivation_ref integer not null check (derivation_ref > 0),
  created_at timestamptz not null default now(),
  unique (reader_run_id, person_record_ref),
  unique (reader_run_id, world_person_record_id),
  unique (id, owner_id),
  check (cardinality(evidence_refs) > 0),
  check (
    (core_status='confirmed'
      and ca between 0 and 200 and pa between 0 and 200
      and cardinality(position_ratings)=15
      and array_position(position_ratings,null) is null
      and 0 < all(position_ratings) and 20 >= all(position_ratings)
      and cardinality(attributes_1_20)=54
      and array_position(attributes_1_20,null) is null
      and 0 < all(attributes_1_20) and 20 >= all(attributes_1_20)
      and (height_cm is null or height_cm between 100 and 250))
    or
    (core_status<>'confirmed'
      and ca is null and pa is null and position_ratings is null
      and attributes_1_20 is null and height_cm is null)
  ),
  check ((identity_linkage_status='confirmed' and identity_epoch_id is not null and identity_birth_date is not null)
      or (identity_linkage_status<>'confirmed' and identity_epoch_id is null and identity_birth_date is null)),
  foreign key (checkpoint_id, save_id, owner_id, lineage_id)
    references public.world_checkpoints(id, save_id, owner_id, lineage_id) on delete cascade,
  foreign key (reader_run_id, save_id, owner_id, lineage_id)
    references public.world_reader_runs(id, save_id, owner_id, lineage_id) on delete cascade,
  foreign key (world_person_record_id, owner_id)
    references public.world_person_records(id, owner_id) on delete cascade,
  foreign key (person_entity_id, owner_id, uid)
    references public.world_person_entities(id, owner_id, uid) on delete cascade,
  foreign key (identity_epoch_id, owner_id, person_entity_id)
    references public.world_identity_epochs(id, owner_id, person_entity_id)
);

create table private.world_run_player_core_projection (
  reader_run_id uuid not null,
  owner_id uuid not null,
  person_record_ref integer not null check (person_record_ref > 0),
  core_status text not null check (core_status in ('confirmed','unknown','ambiguous','unsupported','excluded')),
  core_reason_code text not null,
  ca smallint,
  pa smallint,
  position_ratings smallint[],
  attributes_1_20 smallint[],
  height_cm smallint,
  evidence_refs integer[] not null,
  derivation_ref integer not null check (derivation_ref > 0),
  primary key (reader_run_id, person_record_ref),
  check (cardinality(evidence_refs) > 0),
  check (
    (core_status='confirmed'
      and ca between 0 and 200 and pa between 0 and 200
      and cardinality(position_ratings)=15
      and array_position(position_ratings,null) is null
      and 0 < all(position_ratings) and 20 >= all(position_ratings)
      and cardinality(attributes_1_20)=54
      and array_position(attributes_1_20,null) is null
      and 0 < all(attributes_1_20) and 20 >= all(attributes_1_20)
      and (height_cm is null or height_cm between 100 and 250))
    or
    (core_status<>'confirmed'
      and ca is null and pa is null and position_ratings is null
      and attributes_1_20 is null and height_cm is null)
  ),
  foreign key (reader_run_id, owner_id)
    references public.world_reader_runs(id, owner_id) on delete cascade
);

create index world_player_core_projection_checkpoint_fk_idx
  on public.world_player_core_projection(checkpoint_id, save_id, owner_id, lineage_id);
create index world_player_core_projection_run_fk_idx
  on public.world_player_core_projection(reader_run_id, save_id, owner_id, lineage_id);
create index world_player_core_projection_record_fk_idx
  on public.world_player_core_projection(world_person_record_id, owner_id);
create index world_player_core_projection_entity_uid_fk_idx
  on public.world_player_core_projection(person_entity_id, owner_id, uid);
create index world_player_core_projection_epoch_entity_fk_idx
  on public.world_player_core_projection(identity_epoch_id, owner_id, person_entity_id);
create index world_player_core_projection_evolution_idx
  on public.world_player_core_projection(owner_id, save_id, uid, checkpoint_date, reader_run_id)
  where is_canonical;
create index world_player_core_projection_epoch_timeline_idx
  on public.world_player_core_projection(owner_id, identity_epoch_id, checkpoint_date, reader_run_id)
  where is_canonical and identity_epoch_id is not null;
create index world_run_player_core_projection_run_owner_fk_idx
  on private.world_run_player_core_projection(reader_run_id, owner_id);

alter table public.world_player_core_projection enable row level security;
alter table private.world_run_player_core_projection enable row level security;
create policy world_player_core_projection_owner on public.world_player_core_projection for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_run_player_core_projection_owner on private.world_run_player_core_projection for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
revoke all on table public.world_player_core_projection from anon;
grant select, insert, update, delete on table public.world_player_core_projection to authenticated, service_role;
revoke all on table private.world_run_player_core_projection from public, anon;
grant select, insert, update, delete on table private.world_run_player_core_projection to authenticated, service_role;

create or replace function public.world_census_stage_player_core_rows(p_reader_run_id uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_owner uuid := auth.uid(); v_row jsonb; v_status text; v_reason text; v_ref integer;
  v_ca smallint; v_pa smallint; v_positions smallint[]; v_attributes smallint[]; v_height smallint;
  v_evidence integer[]; v_derivation integer; v_existing private.world_run_player_core_projection%rowtype;
  v_count integer := 0;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'world_census_player_core_rows_not_array'; end if;
  if not exists(select 1 from public.world_reader_runs where id=p_reader_run_id and owner_id=v_owner and status='staging') then
    raise exception 'world_census_player_core_run_not_staging';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_ref := nullif(v_row->>'person_record_ref','')::integer;
    v_status := v_row->>'status'; v_reason := v_row->>'reason_code';
    v_ca := case when v_row?'ca' and jsonb_typeof(v_row->'ca')='number' then (v_row->>'ca')::smallint else null end;
    v_pa := case when v_row?'pa' and jsonb_typeof(v_row->'pa')='number' then (v_row->>'pa')::smallint else null end;
    v_height := case when v_row?'height_cm' and jsonb_typeof(v_row->'height_cm')='number' then (v_row->>'height_cm')::smallint else null end;
    v_derivation := nullif(v_row->>'derivation_ref','')::integer;
    v_positions := case when jsonb_typeof(v_row->'positions')='array' then array(select value::smallint from jsonb_array_elements_text(v_row->'positions')) else null end;
    v_attributes := case when jsonb_typeof(v_row->'attributes_1_20')='array' then array(select value::smallint from jsonb_array_elements_text(v_row->'attributes_1_20')) else null end;
    v_evidence := case when jsonb_typeof(v_row->'evidence_refs')='array' then array(select value::integer from jsonb_array_elements_text(v_row->'evidence_refs')) else null end;
    if v_ref is null or v_ref<=0 then raise exception 'world_census_player_core_bad_person_ref'; end if;
    if v_status not in ('confirmed','unknown','ambiguous','unsupported','excluded') then raise exception 'world_census_player_core_bad_status:%',coalesce(v_status,'null'); end if;
    if v_reason is null or btrim(v_reason)='' then raise exception 'world_census_player_core_reason_missing:%',v_ref; end if;
    if v_derivation is null or v_derivation<=0 or v_evidence is null or cardinality(v_evidence)=0
      or exists(select 1 from unnest(v_evidence) x where x is null or x<=0) then
      raise exception 'world_census_player_core_provenance_invalid:%',v_ref;
    end if;
    if v_status='confirmed' then
      if v_ca is null or v_ca<0 or v_ca>200 or v_pa is null or v_pa<0 or v_pa>200
        or v_positions is null or cardinality(v_positions)<>15 or exists(select 1 from unnest(v_positions) x where x is null or x<1 or x>20)
        or v_attributes is null or cardinality(v_attributes)<>54 or exists(select 1 from unnest(v_attributes) x where x is null or x<1 or x>20)
        or (v_height is not null and (v_height<100 or v_height>250)) then
        raise exception 'world_census_player_core_confirmed_shape_invalid:%',v_ref;
      end if;
    elsif v_ca is not null or v_pa is not null or v_positions is not null or v_attributes is not null or v_height is not null then
      raise exception 'world_census_player_core_nonconfirmed_has_values:%',v_ref;
    end if;
    select * into v_existing from private.world_run_player_core_projection
      where reader_run_id=p_reader_run_id and owner_id=v_owner and person_record_ref=v_ref for update;
    if found then
      if v_existing.core_status is distinct from v_status or v_existing.core_reason_code is distinct from v_reason
        or v_existing.ca is distinct from v_ca or v_existing.pa is distinct from v_pa
        or v_existing.position_ratings is distinct from v_positions or v_existing.attributes_1_20 is distinct from v_attributes
        or v_existing.height_cm is distinct from v_height or v_existing.evidence_refs is distinct from v_evidence
        or v_existing.derivation_ref is distinct from v_derivation then
        raise exception 'world_census_player_core_replay_conflict:%',v_ref;
      end if;
    else
      insert into private.world_run_player_core_projection(reader_run_id,owner_id,person_record_ref,core_status,core_reason_code,ca,pa,position_ratings,attributes_1_20,height_cm,evidence_refs,derivation_ref)
      values(p_reader_run_id,v_owner,v_ref,v_status,v_reason,v_ca,v_pa,v_positions,v_attributes,v_height,v_evidence,v_derivation);
    end if;
    v_count := v_count+1;
  end loop;
  return jsonb_build_object('staged',v_count);
end $$;
revoke all on function public.world_census_stage_player_core_rows(uuid,jsonb) from public, anon;
grant execute on function public.world_census_stage_player_core_rows(uuid,jsonb) to authenticated;

create or replace function private.world_census_promote_player_core_projection(p_reader_run_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_owner uuid := auth.uid(); v_run public.world_reader_runs%rowtype; v_checkpoint public.world_checkpoints%rowtype;
  v_package public.world_state_packages%rowtype; v_expected integer; v_staged integer; v_joined integer; v_inserted integer;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  select * into v_run from public.world_reader_runs where id=p_reader_run_id and owner_id=v_owner and status='complete' for update;
  if not found then raise exception 'world_census_player_core_run_not_complete'; end if;
  select * into v_checkpoint from public.world_checkpoints where id=v_run.checkpoint_id and owner_id=v_owner for update;
  if not found or v_checkpoint.canonical_reader_run_id is distinct from v_run.id then raise exception 'world_census_player_core_run_not_canonical'; end if;
  select * into v_package from public.world_state_packages where reader_run_id=v_run.id and owner_id=v_owner and status='complete';
  if not found then raise exception 'world_census_player_core_package_missing'; end if;
  v_expected := coalesce((v_package.domain_counts->>'player_core_facts')::integer,0);
  select count(*) into v_staged from private.world_run_player_core_projection where reader_run_id=v_run.id and owner_id=v_owner;
  if v_staged<>v_expected then raise exception 'world_census_player_core_stage_incomplete:%:%',v_staged,v_expected; end if;
  select count(*) into v_joined from private.world_run_player_core_projection s
    join public.world_person_records pr on pr.reader_run_id=s.reader_run_id and pr.person_record_ref=s.person_record_ref and pr.owner_id=s.owner_id
    where s.reader_run_id=v_run.id and s.owner_id=v_owner;
  if v_joined<>v_expected then raise exception 'world_census_player_core_person_record_join_incomplete:%:%',v_joined,v_expected; end if;
  update public.world_player_core_projection set is_canonical=false
    where owner_id=v_owner and checkpoint_id=v_checkpoint.id and is_canonical and reader_run_id<>v_run.id;
  insert into public.world_player_core_projection(owner_id,save_id,lineage_id,checkpoint_id,reader_run_id,world_person_record_id,person_entity_id,identity_epoch_id,person_record_ref,uid,checkpoint_date,is_canonical,identity_linkage_status,identity_linkage_reason,identity_birth_date,core_status,core_reason_code,ca,pa,position_ratings,attributes_1_20,height_cm,evidence_refs,derivation_ref)
  select v_owner,v_run.save_id,v_run.lineage_id,v_checkpoint.id,v_run.id,pr.id,pr.person_entity_id,pr.identity_epoch_id,pr.person_record_ref,pr.uid,v_checkpoint.checkpoint_date,true,pr.linkage_status,pr.linkage_reason,e.birth_date,s.core_status,s.core_reason_code,s.ca,s.pa,s.position_ratings,s.attributes_1_20,s.height_cm,s.evidence_refs,s.derivation_ref
    from private.world_run_player_core_projection s
    join public.world_person_records pr on pr.reader_run_id=s.reader_run_id and pr.person_record_ref=s.person_record_ref and pr.owner_id=s.owner_id
    left join public.world_identity_epochs e on e.id=pr.identity_epoch_id and e.owner_id=pr.owner_id and e.person_entity_id=pr.person_entity_id
    where s.reader_run_id=v_run.id and s.owner_id=v_owner;
  get diagnostics v_inserted = row_count;
  if v_inserted<>v_expected then raise exception 'world_census_player_core_projection_count_mismatch:%:%',v_inserted,v_expected; end if;
  delete from private.world_run_player_core_projection where reader_run_id=v_run.id and owner_id=v_owner;
  return jsonb_build_object('player_core_rows',v_inserted);
end $$;
revoke all on function private.world_census_promote_player_core_projection(uuid) from public, anon;
grant execute on function private.world_census_promote_player_core_projection(uuid) to authenticated, service_role;

create or replace function private.world_census_finalize_with_identity(p_reader_run_id uuid,p_coverage_manifest jsonb,p_coverage_hash text,p_run_end jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_result jsonb; v_identity jsonb;
begin
  v_result := private.world_census_finalize(p_reader_run_id,p_coverage_manifest,p_coverage_hash,p_run_end);
  if coalesce((v_result->>'already_complete')::boolean,false) then return v_result; end if;
  v_identity := private.world_census_promote_identity_registry(p_reader_run_id);
  return v_result || jsonb_build_object('identity_registry',v_identity);
end $$;
revoke all on function private.world_census_finalize_with_identity(uuid,jsonb,text,jsonb) from public, anon;
grant execute on function private.world_census_finalize_with_identity(uuid,jsonb,text,jsonb) to authenticated, service_role;

create or replace function public.world_census_finalize(p_reader_run_id uuid,p_coverage_manifest jsonb,p_coverage_hash text,p_run_end jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_result jsonb; v_projection jsonb;
begin
  v_result := private.world_census_finalize_with_identity(p_reader_run_id,p_coverage_manifest,p_coverage_hash,p_run_end);
  if coalesce((v_result->>'already_complete')::boolean,false) then return v_result; end if;
  v_projection := private.world_census_promote_player_core_projection(p_reader_run_id);
  return v_result || jsonb_build_object('player_core_projection',v_projection);
end $$;

create or replace function public.world_census_fail(p_reader_run_id uuid,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_result jsonb; v_owner uuid := auth.uid();
begin
  v_result := private.world_census_fail(p_reader_run_id,p_reason);
  if coalesce((v_result->>'changed')::boolean,false) then
    delete from private.world_run_person_identity where reader_run_id=p_reader_run_id and owner_id=v_owner;
    delete from private.world_run_player_core_projection where reader_run_id=p_reader_run_id and owner_id=v_owner;
  end if;
  return v_result;
end $$;
revoke all on function public.world_census_finalize(uuid,jsonb,text,jsonb) from public, anon;
revoke all on function public.world_census_fail(uuid,text) from public, anon;
grant execute on function public.world_census_finalize(uuid,jsonb,text,jsonb) to authenticated;
grant execute on function public.world_census_fail(uuid,text) to authenticated;
notify pgrst,'reload schema';

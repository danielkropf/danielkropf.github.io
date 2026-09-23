-- FM DataTracker 0.48.0 — WC-D World Census identity registry.
-- Adds a minimal lineage/UID/identity-epoch registry and promotes checkpoint-local
-- PersonRecords only as part of the same transaction that canonicalizes a ReaderRun.

create table public.world_person_entities (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  lineage_id uuid not null,
  uid bigint not null check (uid > 0),
  created_reader_run_id uuid,
  created_at timestamptz not null default now(),
  unique (lineage_id, uid),
  unique (id, owner_id),
  unique (id, owner_id, lineage_id),
  unique (id, owner_id, uid),
  foreign key (lineage_id, save_id, owner_id)
    references public.world_lineages(id, save_id, owner_id) on delete cascade,
  foreign key (created_reader_run_id, owner_id)
    references public.world_reader_runs(id, owner_id) on delete set null (created_reader_run_id)
);

create table public.world_identity_epochs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  person_entity_id uuid not null,
  epoch_ordinal integer not null check (epoch_ordinal > 0),
  birth_date date not null,
  initial_display_name text,
  initial_hidden_personality smallint[],
  predecessor_epoch_id uuid,
  first_reader_run_id uuid,
  first_checkpoint_id uuid,
  first_checkpoint_date date,
  last_reader_run_id uuid,
  last_checkpoint_id uuid,
  last_checkpoint_date date,
  status text not null default 'active' check (status in ('active','retired')),
  retired_reader_run_id uuid,
  retired_checkpoint_id uuid,
  retired_checkpoint_date date,
  retirement_reason text,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (person_entity_id, epoch_ordinal),
  unique (id, owner_id),
  unique (id, owner_id, person_entity_id),
  check (initial_hidden_personality is null or cardinality(initial_hidden_personality)=8),
  check ((status='active' and retired_at is null)
      or (status='retired' and retired_at is not null)),
  foreign key (person_entity_id, owner_id)
    references public.world_person_entities(id, owner_id) on delete cascade,
  foreign key (predecessor_epoch_id, owner_id)
    references public.world_identity_epochs(id, owner_id) on delete set null (predecessor_epoch_id),
  foreign key (first_reader_run_id, owner_id)
    references public.world_reader_runs(id, owner_id) on delete set null (first_reader_run_id),
  foreign key (last_reader_run_id, owner_id)
    references public.world_reader_runs(id, owner_id) on delete set null (last_reader_run_id),
  foreign key (retired_reader_run_id, owner_id)
    references public.world_reader_runs(id, owner_id) on delete set null (retired_reader_run_id),
  foreign key (first_checkpoint_id, owner_id)
    references public.world_checkpoints(id, owner_id) on delete set null (first_checkpoint_id),
  foreign key (last_checkpoint_id, owner_id)
    references public.world_checkpoints(id, owner_id) on delete set null (last_checkpoint_id),
  foreign key (retired_checkpoint_id, owner_id)
    references public.world_checkpoints(id, owner_id) on delete set null (retired_checkpoint_id)
);

create unique index world_identity_epochs_one_active_idx
  on public.world_identity_epochs(person_entity_id)
  where status='active';

create table public.world_person_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  reader_run_id uuid not null,
  person_entity_id uuid not null,
  identity_epoch_id uuid,
  person_record_ref integer not null check (person_record_ref > 0),
  person_record_key text not null,
  eid integer not null check (eid > 0),
  uid bigint not null check (uid > 0),
  identity_offset bigint not null check (identity_offset >= 0),
  boundary_start bigint not null check (boundary_start >= 0),
  boundary_end bigint not null check (boundary_end >= boundary_start),
  resolution_method text not null check (resolution_method in ('unique_player_stats_identity','structural_team_matching_contract_identity')),
  linkage_status text not null check (linkage_status in ('confirmed','unknown','ambiguous','unsupported','excluded')),
  linkage_reason text not null,
  created_at timestamptz not null default now(),
  unique (reader_run_id, person_record_ref),
  unique (reader_run_id, person_record_key),
  unique (id, owner_id),
  check ((linkage_status='confirmed' and identity_epoch_id is not null)
      or (linkage_status<>'confirmed' and identity_epoch_id is null)),
  foreign key (reader_run_id, owner_id)
    references public.world_reader_runs(id, owner_id) on delete cascade,
  foreign key (person_entity_id, owner_id, uid)
    references public.world_person_entities(id, owner_id, uid) on delete cascade,
  foreign key (identity_epoch_id, owner_id, person_entity_id)
    references public.world_identity_epochs(id, owner_id, person_entity_id)
);

create table private.world_run_person_identity (
  reader_run_id uuid not null,
  owner_id uuid not null,
  person_record_ref integer not null check (person_record_ref > 0),
  person_received boolean not null default false,
  biography_received boolean not null default false,
  person_record_key text,
  eid integer,
  uid bigint,
  identity_offset bigint,
  boundary_start bigint,
  boundary_end bigint,
  resolution_method text,
  biography_status text,
  biography_reason_code text,
  birth_date date,
  display_name text,
  hidden_personality smallint[],
  primary key (reader_run_id, person_record_ref),
  foreign key (reader_run_id, owner_id)
    references public.world_reader_runs(id, owner_id) on delete cascade,
  check (not person_received or (
    person_record_key is not null and eid is not null and uid is not null
    and identity_offset is not null and boundary_start is not null and boundary_end is not null
    and resolution_method is not null
  )),
  check (not biography_received or biography_status in ('confirmed','unknown','ambiguous','unsupported','excluded')),
  check (hidden_personality is null or cardinality(hidden_personality)=8)
);

create unique index world_run_person_identity_key_idx
  on private.world_run_person_identity(reader_run_id, person_record_key)
  where person_received;

create index world_person_entities_lineage_save_owner_fk_idx
  on public.world_person_entities(lineage_id, save_id, owner_id);
create index world_person_entities_created_run_owner_fk_idx
  on public.world_person_entities(created_reader_run_id, owner_id);
create index world_identity_epochs_entity_owner_fk_idx
  on public.world_identity_epochs(person_entity_id, owner_id);
create index world_identity_epochs_predecessor_owner_fk_idx
  on public.world_identity_epochs(predecessor_epoch_id, owner_id);
create index world_identity_epochs_first_run_owner_fk_idx
  on public.world_identity_epochs(first_reader_run_id, owner_id);
create index world_identity_epochs_last_run_owner_fk_idx
  on public.world_identity_epochs(last_reader_run_id, owner_id);
create index world_identity_epochs_retired_run_owner_fk_idx
  on public.world_identity_epochs(retired_reader_run_id, owner_id);
create index world_identity_epochs_first_checkpoint_owner_fk_idx
  on public.world_identity_epochs(first_checkpoint_id, owner_id);
create index world_identity_epochs_last_checkpoint_owner_fk_idx
  on public.world_identity_epochs(last_checkpoint_id, owner_id);
create index world_identity_epochs_retired_checkpoint_owner_fk_idx
  on public.world_identity_epochs(retired_checkpoint_id, owner_id);
create index world_person_records_run_owner_fk_idx
  on public.world_person_records(reader_run_id, owner_id);
create index world_person_records_entity_owner_uid_fk_idx
  on public.world_person_records(person_entity_id, owner_id, uid);
create index world_person_records_epoch_owner_entity_fk_idx
  on public.world_person_records(identity_epoch_id, owner_id, person_entity_id);
create index world_run_person_identity_run_owner_fk_idx
  on private.world_run_person_identity(reader_run_id, owner_id);

alter table public.world_person_entities enable row level security;
alter table public.world_identity_epochs enable row level security;
alter table public.world_person_records enable row level security;
alter table private.world_run_person_identity enable row level security;

create policy world_person_entities_owner on public.world_person_entities for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_identity_epochs_owner on public.world_identity_epochs for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_person_records_owner on public.world_person_records for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy world_run_person_identity_owner on private.world_run_person_identity for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));

revoke all on table public.world_person_entities, public.world_identity_epochs, public.world_person_records from anon;
grant select, insert, update, delete on table public.world_person_entities, public.world_identity_epochs, public.world_person_records to authenticated, service_role;
revoke all on table private.world_run_person_identity from public, anon;
grant select, insert, update, delete on table private.world_run_person_identity to authenticated, service_role;

create or replace function private.world_identity_epoch_guard_immutable()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if old.person_entity_id is distinct from new.person_entity_id
    or old.epoch_ordinal is distinct from new.epoch_ordinal
    or old.birth_date is distinct from new.birth_date
    or old.initial_display_name is distinct from new.initial_display_name
    or old.initial_hidden_personality is distinct from new.initial_hidden_personality
    or old.predecessor_epoch_id is distinct from new.predecessor_epoch_id then
    raise exception 'world_census_identity_epoch_guard_is_immutable';
  end if;
  return new;
end
$$;
revoke all on function private.world_identity_epoch_guard_immutable() from public, anon, authenticated;

create trigger world_identity_epoch_guard_immutable
before update on public.world_identity_epochs
for each row execute function private.world_identity_epoch_guard_immutable();

create or replace function public.world_census_stage_identity_rows(
  p_reader_run_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner uuid := auth.uid();
  v_row jsonb;
  v_kind text;
  v_ref integer;
  v_existing private.world_run_person_identity%rowtype;
  v_key text;
  v_eid integer;
  v_uid bigint;
  v_identity_offset bigint;
  v_boundary_start bigint;
  v_boundary_end bigint;
  v_resolution text;
  v_status text;
  v_reason text;
  v_birth date;
  v_display text;
  v_hidden smallint[];
  v_hidden_value smallint;
  v_count integer := 0;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'world_census_identity_rows_not_array'; end if;
  perform 1 from public.world_reader_runs
    where id=p_reader_run_id and owner_id=v_owner and status='staging'
    for update;
  if not found then raise exception 'world_census_run_not_staging'; end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_kind := v_row->>'kind';
    v_ref := nullif(v_row->>'person_record_ref','')::integer;
    if v_ref is null or v_ref<=0 or v_kind not in ('person_record','biography_fact') then
      raise exception 'world_census_invalid_identity_stage_row';
    end if;

    select * into v_existing from private.world_run_person_identity
      where reader_run_id=p_reader_run_id and owner_id=v_owner and person_record_ref=v_ref
      for update;

    if v_kind='person_record' then
      v_key := nullif(v_row->>'person_record_key','');
      v_eid := nullif(v_row->>'eid','')::integer;
      v_uid := nullif(v_row->>'uid','')::bigint;
      v_identity_offset := nullif(v_row->>'identity_offset','')::bigint;
      v_boundary_start := nullif(v_row->>'boundary_start','')::bigint;
      v_boundary_end := nullif(v_row->>'boundary_end','')::bigint;
      v_resolution := v_row->>'resolution_method';
      if v_key is null or v_eid is null or v_eid<=0 or v_uid is null or v_uid<=0
        or v_identity_offset is null or v_identity_offset<0
        or v_boundary_start is null or v_boundary_start<0
        or v_boundary_end is null or v_boundary_end<>v_identity_offset or v_boundary_start>v_boundary_end
        or v_resolution not in ('unique_player_stats_identity','structural_team_matching_contract_identity') then
        raise exception 'world_census_invalid_person_identity_stage:%',v_ref;
      end if;
      if found and v_existing.person_received then
        if v_existing.person_record_key is distinct from v_key or v_existing.eid is distinct from v_eid
          or v_existing.uid is distinct from v_uid or v_existing.identity_offset is distinct from v_identity_offset
          or v_existing.boundary_start is distinct from v_boundary_start or v_existing.boundary_end is distinct from v_boundary_end
          or v_existing.resolution_method is distinct from v_resolution then
          raise exception 'world_census_identity_stage_conflict:%:person_record',v_ref;
        end if;
      elsif found then
        update private.world_run_person_identity set
          person_received=true,person_record_key=v_key,eid=v_eid,uid=v_uid,identity_offset=v_identity_offset,
          boundary_start=v_boundary_start,boundary_end=v_boundary_end,resolution_method=v_resolution
        where reader_run_id=p_reader_run_id and owner_id=v_owner and person_record_ref=v_ref;
      else
        insert into private.world_run_person_identity(
          reader_run_id,owner_id,person_record_ref,person_received,person_record_key,eid,uid,
          identity_offset,boundary_start,boundary_end,resolution_method
        ) values (
          p_reader_run_id,v_owner,v_ref,true,v_key,v_eid,v_uid,v_identity_offset,v_boundary_start,v_boundary_end,v_resolution
        );
      end if;
    else
      v_status := v_row->>'status';
      v_reason := nullif(v_row->>'reason_code','');
      v_birth := nullif(v_row->>'birth_date','')::date;
      v_display := nullif(v_row->>'display_name','');
      v_hidden := null;
      if v_row ? 'hidden_personality' and v_row->'hidden_personality' <> 'null'::jsonb then
        if jsonb_typeof(v_row->'hidden_personality')<>'array' then raise exception 'world_census_invalid_hidden_personality:%',v_ref; end if;
        select array_agg(value::smallint order by ordinality) into v_hidden
        from jsonb_array_elements_text(v_row->'hidden_personality') with ordinality as values(value,ordinality);
        if cardinality(v_hidden)<>8 then raise exception 'world_census_invalid_hidden_personality:%',v_ref; end if;
        foreach v_hidden_value in array v_hidden loop
          if v_hidden_value<0 or v_hidden_value>20 then raise exception 'world_census_invalid_hidden_personality:%',v_ref; end if;
        end loop;
      end if;
      if v_status not in ('confirmed','unknown','ambiguous','unsupported','excluded') or v_reason is null then
        raise exception 'world_census_invalid_biography_identity_stage:%',v_ref;
      end if;
      if v_status='confirmed' and (v_birth is null or v_display is null or v_hidden is null) then
        raise exception 'world_census_confirmed_biography_guard_incomplete:%',v_ref;
      end if;
      if v_status<>'confirmed' and (v_birth is not null or v_hidden is not null) then
        raise exception 'world_census_nonconfirmed_biography_carries_guard:%',v_ref;
      end if;
      if found and v_existing.biography_received then
        if v_existing.biography_status is distinct from v_status or v_existing.biography_reason_code is distinct from v_reason
          or v_existing.birth_date is distinct from v_birth or v_existing.display_name is distinct from v_display
          or v_existing.hidden_personality is distinct from v_hidden then
          raise exception 'world_census_identity_stage_conflict:%:biography_fact',v_ref;
        end if;
      elsif found then
        update private.world_run_person_identity set
          biography_received=true,biography_status=v_status,biography_reason_code=v_reason,
          birth_date=v_birth,display_name=v_display,hidden_personality=v_hidden
        where reader_run_id=p_reader_run_id and owner_id=v_owner and person_record_ref=v_ref;
      else
        insert into private.world_run_person_identity(
          reader_run_id,owner_id,person_record_ref,biography_received,biography_status,biography_reason_code,
          birth_date,display_name,hidden_personality
        ) values (
          p_reader_run_id,v_owner,v_ref,true,v_status,v_reason,v_birth,v_display,v_hidden
        );
      end if;
    end if;
    v_count := v_count+1;
  end loop;
  return jsonb_build_object('staged',v_count);
end
$$;

create or replace function private.world_census_promote_identity_registry(
  p_reader_run_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner uuid := auth.uid();
  v_run public.world_reader_runs%rowtype;
  v_checkpoint public.world_checkpoints%rowtype;
  v_package public.world_state_packages%rowtype;
  v_stage private.world_run_person_identity%rowtype;
  v_entity public.world_person_entities%rowtype;
  v_same public.world_identity_epochs%rowtype;
  v_prev public.world_identity_epochs%rowtype;
  v_prev_record public.world_person_records%rowtype;
  v_prev_record_found boolean := false;
  v_next public.world_identity_epochs%rowtype;
  v_epoch public.world_identity_epochs%rowtype;
  v_expected integer;
  v_staged integer;
  v_incomplete integer;
  v_ordinal integer;
  v_linkage_status text;
  v_linkage_reason text;
  v_created_epochs integer := 0;
  v_reused_epochs integer := 0;
  v_unresolved integer := 0;
  v_predecessor uuid;
begin
  if v_owner is null then raise exception 'world_census_not_authenticated'; end if;
  select * into v_run from public.world_reader_runs
    where id=p_reader_run_id and owner_id=v_owner and status='complete'
    for update;
  if not found then raise exception 'world_census_identity_run_not_complete'; end if;
  select * into v_checkpoint from public.world_checkpoints
    where id=v_run.checkpoint_id and owner_id=v_owner for update;
  if not found or v_checkpoint.canonical_reader_run_id is distinct from v_run.id then
    raise exception 'world_census_identity_run_not_canonical';
  end if;
  select * into v_package from public.world_state_packages
    where reader_run_id=v_run.id and owner_id=v_owner and status='complete';
  if not found then raise exception 'world_census_identity_package_missing'; end if;
  v_expected := coalesce((v_package.domain_counts->>'person_records')::integer,0);
  select count(*),count(*) filter(where not person_received or not biography_received)
    into v_staged,v_incomplete
  from private.world_run_person_identity
  where reader_run_id=v_run.id and owner_id=v_owner;
  if v_staged<>v_expected or v_incomplete<>0 then
    raise exception 'world_census_identity_stage_incomplete:%:%:%',v_staged,v_expected,v_incomplete;
  end if;
  if exists(
    select 1 from private.world_run_person_identity
    where reader_run_id=v_run.id and owner_id=v_owner and person_received
    group by uid having count(*)>1
  ) then
    raise exception 'world_census_identity_duplicate_uid_in_run';
  end if;
  perform 1 from public.world_lineages where id=v_run.lineage_id and owner_id=v_owner for update;
  if not found then raise exception 'world_census_identity_lineage_missing'; end if;

  for v_stage in
    select * from private.world_run_person_identity
    where reader_run_id=v_run.id and owner_id=v_owner
    order by person_record_ref
  loop
    insert into public.world_person_entities(save_id,owner_id,lineage_id,uid,created_reader_run_id)
    values(v_run.save_id,v_owner,v_run.lineage_id,v_stage.uid,v_run.id)
    on conflict(lineage_id,uid) do nothing;
    select * into v_entity from public.world_person_entities
      where lineage_id=v_run.lineage_id and uid=v_stage.uid and owner_id=v_owner;
    if not found then raise exception 'world_census_identity_entity_missing:%',v_stage.person_record_ref; end if;

    v_linkage_status := case v_stage.biography_status
      when 'confirmed' then 'confirmed'
      when 'ambiguous' then 'ambiguous'
      when 'unsupported' then 'unsupported'
      when 'excluded' then 'excluded'
      else 'unknown' end;
    v_linkage_reason := coalesce(v_stage.biography_reason_code,'biography_identity_unavailable');
    v_epoch.id := null;
    v_same.id := null;
    v_prev.id := null;
    v_prev_record.id := null;
    v_prev_record_found := false;
    v_next.id := null;

    select e.* into v_same
    from public.world_person_records pr
    join public.world_reader_runs rr on rr.id=pr.reader_run_id and rr.owner_id=pr.owner_id
    join public.world_identity_epochs e on e.id=pr.identity_epoch_id and e.owner_id=pr.owner_id
    where rr.checkpoint_id=v_run.checkpoint_id and rr.id<>v_run.id and pr.owner_id=v_owner
      and pr.person_entity_id=v_entity.id and pr.identity_epoch_id is not null
    order by pr.created_at desc limit 1;

    -- The immediately previous observation for this UID is authoritative for
    -- continuity when it exists. An explicit unknown/ambiguous PersonRecord
    -- must not be skipped in favor of an older confirmed epoch.
    select pr.* into v_prev_record
    from public.world_checkpoints c
    join public.world_reader_runs rr on rr.id=c.canonical_reader_run_id and rr.owner_id=c.owner_id
    join public.world_person_records pr on pr.reader_run_id=rr.id and pr.owner_id=rr.owner_id
    where c.owner_id=v_owner and c.lineage_id=v_run.lineage_id
      and c.checkpoint_date is not null and v_checkpoint.checkpoint_date is not null
      and c.checkpoint_date<v_checkpoint.checkpoint_date
      and pr.person_entity_id=v_entity.id
    order by c.checkpoint_date desc,c.created_at desc limit 1;
    v_prev_record_found := found;
    if v_prev_record_found and v_prev_record.identity_epoch_id is not null then
      select * into v_prev from public.world_identity_epochs
      where id=v_prev_record.identity_epoch_id and owner_id=v_owner;
    end if;

    select e.* into v_next
    from public.world_checkpoints c
    join public.world_reader_runs rr on rr.id=c.canonical_reader_run_id and rr.owner_id=c.owner_id
    join public.world_person_records pr on pr.reader_run_id=rr.id and pr.owner_id=rr.owner_id
    join public.world_identity_epochs e on e.id=pr.identity_epoch_id and e.owner_id=pr.owner_id
    where c.owner_id=v_owner and c.lineage_id=v_run.lineage_id
      and c.checkpoint_date is not null and v_checkpoint.checkpoint_date is not null
      and c.checkpoint_date>v_checkpoint.checkpoint_date
      and pr.person_entity_id=v_entity.id and pr.identity_epoch_id is not null
    order by c.checkpoint_date asc,c.created_at asc limit 1;

    if v_stage.biography_status='confirmed' and v_stage.birth_date is not null then
      if v_same.id is not null and v_same.birth_date=v_stage.birth_date then
        v_epoch := v_same;
        v_linkage_reason := 'same_checkpoint_reprocess_birth_guard';
      elsif v_same.id is not null and v_same.birth_date<>v_stage.birth_date and v_next.id is not null then
        v_linkage_status := 'ambiguous';
        v_linkage_reason := 'historical_reprocess_epoch_transition_requires_forward_reconcile';
      elsif v_prev_record_found and v_prev_record.identity_epoch_id is null and v_next.id is not null then
        v_linkage_status := 'ambiguous';
        v_linkage_reason := 'historical_identity_gap_requires_forward_reconcile';
      elsif v_prev_record_found and v_prev_record.identity_epoch_id is null then
        -- A canonical unresolved observation explicitly breaks continuity.
        -- Resume with a fresh epoch instead of carrying an older epoch across
        -- the gap, even when the birth guard later matches again.
        select * into v_prev from public.world_identity_epochs
        where person_entity_id=v_entity.id and owner_id=v_owner and status='active'
        order by epoch_ordinal desc limit 1 for update;
        v_predecessor := v_prev.id;
        if v_predecessor is not null then
          update public.world_identity_epochs set
            status='retired',retired_reader_run_id=v_run.id,retired_checkpoint_id=v_checkpoint.id,
            retired_checkpoint_date=v_checkpoint.checkpoint_date,
            retirement_reason='identity_continuity_broken_by_unresolved_observation',retired_at=now()
          where id=v_predecessor and owner_id=v_owner and status='active';
        end if;
        select coalesce(max(epoch_ordinal),0)+1 into v_ordinal
          from public.world_identity_epochs where person_entity_id=v_entity.id and owner_id=v_owner;
        insert into public.world_identity_epochs(
          owner_id,person_entity_id,epoch_ordinal,birth_date,initial_display_name,initial_hidden_personality,
          predecessor_epoch_id,first_reader_run_id,first_checkpoint_id,first_checkpoint_date,
          last_reader_run_id,last_checkpoint_id,last_checkpoint_date,status
        ) values (
          v_owner,v_entity.id,v_ordinal,v_stage.birth_date,v_stage.display_name,v_stage.hidden_personality,
          v_predecessor,v_run.id,v_checkpoint.id,v_checkpoint.checkpoint_date,
          v_run.id,v_checkpoint.id,v_checkpoint.checkpoint_date,'active'
        ) returning * into v_epoch;
        v_created_epochs := v_created_epochs+1;
        v_linkage_reason := 'new_epoch_after_identity_gap';
      elsif v_prev.id is not null and v_prev.birth_date=v_stage.birth_date then
        if v_next.id is not null and v_next.birth_date=v_stage.birth_date and v_next.id<>v_prev.id then
          v_linkage_status := 'ambiguous';
          v_linkage_reason := 'neighbor_epoch_disagreement';
        else
          v_epoch := v_prev;
          v_linkage_reason := 'same_epoch_birth_guard';
        end if;
      elsif v_next.id is not null and v_next.birth_date=v_stage.birth_date then
        v_epoch := v_next;
        v_linkage_reason := 'historical_backfill_same_epoch_birth_guard';
      elsif v_next.id is not null then
        v_linkage_status := 'ambiguous';
        v_linkage_reason := 'historical_epoch_transition_requires_forward_reconcile';
      else
        v_predecessor := case when v_same.id is not null then v_same.id else v_prev.id end;
        if v_predecessor is not null then
          update public.world_identity_epochs set
            status='retired',retired_reader_run_id=v_run.id,retired_checkpoint_id=v_checkpoint.id,
            retired_checkpoint_date=v_checkpoint.checkpoint_date,
            retirement_reason=case when v_same.id is not null then 'same_checkpoint_reprocess_birth_conflict' else 'strong_birth_conflict' end,
            retired_at=now()
          where id=v_predecessor and owner_id=v_owner and status='active';
        end if;
        select coalesce(max(epoch_ordinal),0)+1 into v_ordinal
          from public.world_identity_epochs where person_entity_id=v_entity.id and owner_id=v_owner;
        insert into public.world_identity_epochs(
          owner_id,person_entity_id,epoch_ordinal,birth_date,initial_display_name,initial_hidden_personality,
          predecessor_epoch_id,first_reader_run_id,first_checkpoint_id,first_checkpoint_date,
          last_reader_run_id,last_checkpoint_id,last_checkpoint_date,status
        ) values (
          v_owner,v_entity.id,v_ordinal,v_stage.birth_date,v_stage.display_name,v_stage.hidden_personality,
          v_predecessor,v_run.id,v_checkpoint.id,v_checkpoint.checkpoint_date,
          v_run.id,v_checkpoint.id,v_checkpoint.checkpoint_date,'active'
        ) returning * into v_epoch;
        v_created_epochs := v_created_epochs+1;
        v_linkage_reason := case when v_predecessor is null then 'initial_epoch_birth_guard' else 'new_epoch_birth_conflict' end;
      end if;

      if v_epoch.id is not null then
        if v_epoch.status='retired' and v_epoch.retired_checkpoint_date is not null
          and v_checkpoint.checkpoint_date is not null and v_checkpoint.checkpoint_date>=v_epoch.retired_checkpoint_date then
          v_epoch.id := null;
          v_linkage_status := 'ambiguous';
          v_linkage_reason := 'epoch_reuse_after_retirement_blocked';
        else
          update public.world_identity_epochs set
            first_reader_run_id=case when first_checkpoint_date is null or (v_checkpoint.checkpoint_date is not null and v_checkpoint.checkpoint_date<first_checkpoint_date) then v_run.id else first_reader_run_id end,
            first_checkpoint_id=case when first_checkpoint_date is null or (v_checkpoint.checkpoint_date is not null and v_checkpoint.checkpoint_date<first_checkpoint_date) then v_checkpoint.id else first_checkpoint_id end,
            first_checkpoint_date=case when first_checkpoint_date is null then v_checkpoint.checkpoint_date when v_checkpoint.checkpoint_date is null then first_checkpoint_date else least(first_checkpoint_date,v_checkpoint.checkpoint_date) end,
            last_reader_run_id=case when last_checkpoint_date is null or (v_checkpoint.checkpoint_date is not null and v_checkpoint.checkpoint_date>last_checkpoint_date) then v_run.id else last_reader_run_id end,
            last_checkpoint_id=case when last_checkpoint_date is null or (v_checkpoint.checkpoint_date is not null and v_checkpoint.checkpoint_date>last_checkpoint_date) then v_checkpoint.id else last_checkpoint_id end,
            last_checkpoint_date=case when last_checkpoint_date is null then v_checkpoint.checkpoint_date when v_checkpoint.checkpoint_date is null then last_checkpoint_date else greatest(last_checkpoint_date,v_checkpoint.checkpoint_date) end
          where id=v_epoch.id and owner_id=v_owner;
          if v_linkage_reason not in ('initial_epoch_birth_guard','new_epoch_birth_conflict') then v_reused_epochs:=v_reused_epochs+1; end if;
        end if;
      end if;
    else
      if v_same.id is not null and v_next.id is null and v_same.status='active' then
        update public.world_identity_epochs set
          status='retired',retired_reader_run_id=v_run.id,retired_checkpoint_id=v_checkpoint.id,
          retired_checkpoint_date=v_checkpoint.checkpoint_date,retirement_reason='canonical_reprocess_identity_unresolved',retired_at=now()
        where id=v_same.id and owner_id=v_owner and status='active';
      end if;
      v_unresolved := v_unresolved+1;
    end if;

    if v_epoch.id is null then
      v_linkage_status := case when v_linkage_status='confirmed' then 'ambiguous' else v_linkage_status end;
      v_unresolved := v_unresolved+case when v_stage.biography_status='confirmed' then 1 else 0 end;
    end if;

    insert into public.world_person_records(
      owner_id,reader_run_id,person_entity_id,identity_epoch_id,person_record_ref,person_record_key,
      eid,uid,identity_offset,boundary_start,boundary_end,resolution_method,linkage_status,linkage_reason
    ) values (
      v_owner,v_run.id,v_entity.id,v_epoch.id,v_stage.person_record_ref,v_stage.person_record_key,
      v_stage.eid,v_stage.uid,v_stage.identity_offset,v_stage.boundary_start,v_stage.boundary_end,
      v_stage.resolution_method,v_linkage_status,v_linkage_reason
    );
  end loop;

  delete from private.world_run_person_identity where reader_run_id=v_run.id and owner_id=v_owner;
  return jsonb_build_object(
    'person_records',v_expected,'created_epochs',v_created_epochs,'reused_epochs',v_reused_epochs,'unresolved',v_unresolved
  );
end
$$;
revoke all on function private.world_census_promote_identity_registry(uuid) from public, anon;
grant execute on function private.world_census_promote_identity_registry(uuid) to authenticated, service_role;

-- Preserve the WC-C finalizer as an internal primitive, then keep the public RPC
-- name stable so old callers fail closed rather than canonicalizing without WC-D.
alter function public.world_census_finalize(uuid,jsonb,text,jsonb) set schema private;
revoke all on function private.world_census_finalize(uuid,jsonb,text,jsonb) from public, anon;
grant execute on function private.world_census_finalize(uuid,jsonb,text,jsonb) to authenticated, service_role;

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
  v_result jsonb;
  v_identity jsonb;
begin
  v_result := private.world_census_finalize(p_reader_run_id,p_coverage_manifest,p_coverage_hash,p_run_end);
  if coalesce((v_result->>'already_complete')::boolean,false) then return v_result; end if;
  v_identity := private.world_census_promote_identity_registry(p_reader_run_id);
  return v_result || jsonb_build_object('identity_registry',v_identity);
end
$$;

alter function public.world_census_fail(uuid,text) set schema private;
revoke all on function private.world_census_fail(uuid,text) from public, anon;
grant execute on function private.world_census_fail(uuid,text) to authenticated, service_role;

create or replace function public.world_census_fail(
  p_reader_run_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_result jsonb;
  v_owner uuid := auth.uid();
begin
  v_result := private.world_census_fail(p_reader_run_id,p_reason);
  if coalesce((v_result->>'changed')::boolean,false) then
    delete from private.world_run_person_identity where reader_run_id=p_reader_run_id and owner_id=v_owner;
  end if;
  return v_result;
end
$$;

revoke all on function public.world_census_stage_identity_rows(uuid,jsonb) from public, anon;
revoke all on function public.world_census_finalize(uuid,jsonb,text,jsonb) from public, anon;
revoke all on function public.world_census_fail(uuid,text) from public, anon;
grant execute on function public.world_census_stage_identity_rows(uuid,jsonb) to authenticated;
grant execute on function public.world_census_finalize(uuid,jsonb,text,jsonb) to authenticated;
grant execute on function public.world_census_fail(uuid,text) to authenticated;

notify pgrst,'reload schema';

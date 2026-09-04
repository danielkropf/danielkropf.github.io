-- FM DataTracker — E-MC-01B
-- Persistent Structural Team -> Club registry, fail-closed factual memberships,
-- Phase0E reconciliation and transactional membership_facts_v1 import enrichment.
--
-- This migration is additive. Historical migrations remain untouched.

-- ---------------------------------------------------------------------------
-- 1. Structural Team -> Club registry + immutable source evidence
-- ---------------------------------------------------------------------------

create table public.club_structural_team_links (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  structural_team_id integer not null check (structural_team_id > 0 and structural_team_id < 100000),
  club_id uuid,
  link_status text not null check (link_status in ('confirmed','legacy_candidate','conflicting')),
  source_import_id uuid,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_structural_team_links_save_team_key unique (save_id, structural_team_id),
  constraint club_structural_team_links_status_club_check check (
    (link_status in ('confirmed','legacy_candidate') and club_id is not null)
    or (link_status='conflicting' and club_id is null)
  ),
  constraint club_structural_team_links_save_owner_fkey foreign key (save_id, owner_id)
    references public.saves(id, owner_id) on delete cascade,
  constraint club_structural_team_links_club_save_owner_fkey foreign key (club_id, save_id, owner_id)
    references public.clubs(id, save_id, owner_id) on delete restrict,
  constraint club_structural_team_links_import_save_fkey foreign key (source_import_id, save_id)
    references public.imports(id, save_id) on delete set null (source_import_id)
);

create index club_structural_team_links_club_id_idx
  on public.club_structural_team_links(club_id);
create index club_structural_team_links_source_import_id_idx
  on public.club_structural_team_links(source_import_id);

create table public.club_structural_team_link_evidence (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  structural_team_id integer not null check (structural_team_id > 0 and structural_team_id < 100000),
  club_id uuid,
  evidence_status text not null check (evidence_status in ('confirmed','legacy_candidate','conflicting')),
  evidence_key text not null,
  organization_ref text,
  organization_team_ids integer[] not null default '{}'::integer[],
  display_name_raw text,
  source_import_id uuid,
  source_snapshot_id uuid,
  source_player_id uuid,
  source_kind text not null check (source_kind in ('fm','legacy')),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint club_structural_team_link_evidence_save_team_key unique (save_id, structural_team_id, evidence_key),
  constraint club_structural_team_link_evidence_key_check check (nullif(btrim(evidence_key),'') is not null),
  constraint club_structural_team_link_evidence_status_club_check check (
    (evidence_status in ('confirmed','legacy_candidate') and club_id is not null and cardinality(organization_team_ids)>0)
    or evidence_status='conflicting'
  ),
  constraint club_structural_team_link_evidence_snapshot_player_check check (
    (source_snapshot_id is null and source_player_id is null)
    or (source_snapshot_id is not null and source_player_id is not null)
  ),
  constraint club_structural_team_link_evidence_save_owner_fkey foreign key (save_id, owner_id)
    references public.saves(id, owner_id) on delete cascade,
  constraint club_structural_team_link_evidence_club_save_owner_fkey foreign key (club_id, save_id, owner_id)
    references public.clubs(id, save_id, owner_id) on delete restrict,
  constraint club_structural_team_link_evidence_import_save_fkey foreign key (source_import_id, save_id)
    references public.imports(id, save_id) on delete cascade,
  constraint club_structural_team_link_evidence_player_save_owner_fkey foreign key (source_player_id, save_id, owner_id)
    references public.players(id, save_id, owner_id) on delete cascade,
  constraint club_structural_team_link_evidence_snapshot_player_save_fkey foreign key (source_snapshot_id, source_player_id, save_id)
    references public.player_snapshots(id, player_id, save_id) on delete cascade
);

create index club_structural_team_link_evidence_club_id_idx
  on public.club_structural_team_link_evidence(club_id);
create index club_structural_team_link_evidence_source_import_id_idx
  on public.club_structural_team_link_evidence(source_import_id);
create index club_structural_team_link_evidence_source_snapshot_id_idx
  on public.club_structural_team_link_evidence(source_snapshot_id);
create index club_structural_team_link_evidence_source_player_id_idx
  on public.club_structural_team_link_evidence(source_player_id);

alter table public.club_structural_team_links enable row level security;
alter table public.club_structural_team_link_evidence enable row level security;

revoke all on table public.club_structural_team_links, public.club_structural_team_link_evidence from anon;
grant select, insert, update, delete on table public.club_structural_team_links, public.club_structural_team_link_evidence to authenticated, service_role;

create policy club_structural_team_links_owner on public.club_structural_team_links
  for all to authenticated
  using (owner_id=(select auth.uid()))
  with check (owner_id=(select auth.uid()));

create policy club_structural_team_link_evidence_owner on public.club_structural_team_link_evidence
  for all to authenticated
  using (owner_id=(select auth.uid()))
  with check (owner_id=(select auth.uid()));

-- Rebuilds one materialized registry row exclusively from surviving evidence.
create or replace function public.datatracker_rebuild_structural_team_link(
  p_save_id uuid,
  p_owner_id uuid,
  p_structural_team_id integer
)
returns void
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_auth uuid := auth.uid();
  v_has_conflict boolean := false;
  v_confirmed_count integer := 0;
  v_confirmed_club uuid;
  v_legacy_count integer := 0;
  v_legacy_club uuid;
  v_status text;
  v_club uuid;
  v_source_import uuid;
  v_first_evidence_key text;
  v_last_evidence_key text;
  v_evidence_count integer := 0;
begin
  if v_auth is not null and v_auth <> p_owner_id then
    raise exception 'E-MC-01B registry owner mismatch';
  end if;
  if p_structural_team_id is null or p_structural_team_id <= 0 or p_structural_team_id >= 100000 then
    raise exception 'E-MC-01B structural Team ID inválido';
  end if;

  select
    count(*),
    coalesce(bool_or(e.evidence_status='conflicting'),false),
    count(distinct e.club_id) filter (where e.evidence_status='confirmed' and e.club_id is not null),
    min(e.club_id::text) filter (where e.evidence_status='confirmed' and e.club_id is not null)::uuid,
    count(distinct e.club_id) filter (where e.evidence_status='legacy_candidate' and e.club_id is not null),
    min(e.club_id::text) filter (where e.evidence_status='legacy_candidate' and e.club_id is not null)::uuid
  into
    v_evidence_count,v_has_conflict,v_confirmed_count,v_confirmed_club,v_legacy_count,v_legacy_club
  from public.club_structural_team_link_evidence e
  where e.save_id=p_save_id
    and e.owner_id=p_owner_id
    and e.structural_team_id=p_structural_team_id;

  if v_evidence_count=0 then
    delete from public.club_structural_team_links l
    where l.save_id=p_save_id and l.owner_id=p_owner_id and l.structural_team_id=p_structural_team_id;
    return;
  end if;

  if v_has_conflict or v_confirmed_count>1 then
    v_status := 'conflicting';
    v_club := null;
  elsif v_confirmed_count=1 then
    v_status := 'confirmed';
    v_club := v_confirmed_club;
  elsif v_legacy_count>1 then
    v_status := 'conflicting';
    v_club := null;
  elsif v_legacy_count=1 then
    v_status := 'legacy_candidate';
    v_club := v_legacy_club;
  else
    v_status := 'conflicting';
    v_club := null;
  end if;

  if v_club is not null then
    select e.source_import_id
      into v_source_import
    from public.club_structural_team_link_evidence e
    where e.save_id=p_save_id
      and e.owner_id=p_owner_id
      and e.structural_team_id=p_structural_team_id
      and e.club_id=v_club
      and e.evidence_status=case when v_status='confirmed' then 'confirmed' else 'legacy_candidate' end
    order by e.created_at desc,e.id desc
    limit 1;
  else
    v_source_import := null;
  end if;

  select e.evidence_key into v_first_evidence_key
  from public.club_structural_team_link_evidence e
  where e.save_id=p_save_id and e.owner_id=p_owner_id and e.structural_team_id=p_structural_team_id
  order by e.created_at,e.id limit 1;

  select e.evidence_key into v_last_evidence_key
  from public.club_structural_team_link_evidence e
  where e.save_id=p_save_id and e.owner_id=p_owner_id and e.structural_team_id=p_structural_team_id
  order by e.created_at desc,e.id desc limit 1;

  insert into public.club_structural_team_links(
    save_id,owner_id,structural_team_id,club_id,link_status,
    source_import_id,provenance
  )
  values(
    p_save_id,p_owner_id,p_structural_team_id,v_club,v_status,
    v_source_import,
    jsonb_build_object(
      'resolution_method','e-mc-01b-evidence-rebuild',
      'first_evidence_key',v_first_evidence_key,
      'last_evidence_key',v_last_evidence_key,
      'evidence_count',v_evidence_count,
      'confirmed_club_count',v_confirmed_count,
      'legacy_candidate_club_count',v_legacy_count
    )
  )
  on conflict(save_id,structural_team_id)
  do update set
    owner_id=excluded.owner_id,
    club_id=excluded.club_id,
    link_status=excluded.link_status,
    source_import_id=excluded.source_import_id,
    provenance=excluded.provenance,
    updated_at=now();
end
$$;

-- Binds one confirmed structural organization to an internal Club identity.
-- Names are creation guards/presentation only and never choose an existing Club.
create or replace function public.datatracker_bind_structural_organization(
  p_save_id uuid,
  p_owner_id uuid,
  p_import_id uuid,
  p_snapshot_id uuid,
  p_player_id uuid,
  p_organization jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_auth uuid := auth.uid();
  v_org_ref text;
  v_raw_team_count integer;
  v_valid_team_count integer;
  v_team_ids integer[];
  v_evidence_team_id integer;
  v_evidence_name text;
  v_evidence_name_status text;
  v_candidate_count integer := 0;
  v_candidate_club uuid;
  v_has_conflicting_link boolean := false;
  v_name_collision_count integer := 0;
  v_club uuid;
  v_team integer;
  v_existing public.club_structural_team_link_evidence%rowtype;
  v_evidence_key text := 'snapshot:'||p_snapshot_id::text;
begin
  if v_auth is not null and v_auth <> p_owner_id then
    raise exception 'E-MC-01B organization owner mismatch';
  end if;
  if not exists(
    select 1 from public.saves s
    where s.id=p_save_id and s.owner_id=p_owner_id
  ) then
    raise exception 'E-MC-01B save não encontrado';
  end if;
  if jsonb_typeof(p_organization)<>'object' then
    return jsonb_build_object('status','unsupported','reason_code','invalid_organization_shape','club_id',null);
  end if;

  v_org_ref := nullif(btrim(p_organization->>'organization_ref'),'');
  if v_org_ref is null or jsonb_typeof(p_organization->'organization_team_ids')<>'array' then
    return jsonb_build_object('status','unsupported','reason_code','invalid_organization_identity','club_id',null);
  end if;

  v_raw_team_count := jsonb_array_length(p_organization->'organization_team_ids');
  select
    count(*),
    array_agg(distinct value::integer order by value::integer)
  into v_valid_team_count,v_team_ids
  from jsonb_array_elements_text(p_organization->'organization_team_ids') as team(value)
  where value ~ '^[0-9]+$'
    and value::bigint > 0
    and value::bigint < 100000;

  if v_raw_team_count=0
     or v_valid_team_count<>v_raw_team_count
     or coalesce(array_length(v_team_ids,1),0)<>v_raw_team_count
  then
    return jsonb_build_object('status','unsupported','reason_code','invalid_or_duplicate_structural_team_set','club_id',null);
  end if;

  v_evidence_name_status := coalesce(nullif(p_organization->>'evidence_team_name_status',''),'unknown');
  if coalesce(p_organization->>'evidence_team_id_raw','') ~ '^[0-9]+$' then
    v_evidence_team_id := (p_organization->>'evidence_team_id_raw')::integer;
  else
    v_evidence_team_id := null;
  end if;
  v_evidence_name := nullif(btrim(p_organization->>'evidence_team_name_raw'),'');

  select exists(
    select 1 from public.club_structural_team_links l
    where l.save_id=p_save_id
      and l.owner_id=p_owner_id
      and l.structural_team_id=any(v_team_ids)
      and l.link_status='conflicting'
  ) into v_has_conflicting_link;

  select
    count(distinct l.club_id),
    min(l.club_id::text)::uuid
  into v_candidate_count,v_candidate_club
  from public.club_structural_team_links l
  where l.save_id=p_save_id
    and l.owner_id=p_owner_id
    and l.structural_team_id=any(v_team_ids)
    and l.link_status in ('confirmed','legacy_candidate')
    and l.club_id is not null;

  if v_has_conflicting_link or v_candidate_count>1 then
    return jsonb_build_object(
      'status','ambiguous',
      'reason_code','multiple_structural_team_club_candidates',
      'candidate_count',v_candidate_count,
      'club_id',null
    );
  end if;

  if v_candidate_count=1 then
    v_club := v_candidate_club;
  else
    if v_evidence_name_status<>'confirmed'
       or v_evidence_name is null
       or v_evidence_team_id is null
       or not (v_evidence_team_id=any(v_team_ids))
    then
      return jsonb_build_object(
        'status','unknown',
        'reason_code','safe_display_name_unavailable',
        'club_id',null
      );
    end if;

    select count(*) into v_name_collision_count
    from public.clubs c
    where c.save_id=p_save_id
      and c.owner_id=p_owner_id
      and c.normalized_name=public.datatracker_normalize_longitudinal_name(v_evidence_name);

    if v_name_collision_count>0 then
      return jsonb_build_object(
        'status','unknown',
        'reason_code','unlinked_name_collision_blocks_creation',
        'name_collision_count',v_name_collision_count,
        'club_id',null
      );
    end if;

    insert into public.clubs(
      save_id,owner_id,fm_club_id,name,normalized_name,source_kind,source_import_id,provenance
    )
    values(
      p_save_id,p_owner_id,null,v_evidence_name,
      public.datatracker_normalize_longitudinal_name(v_evidence_name),
      'fm',p_import_id,
      jsonb_build_object(
        'source_import_id',p_import_id,
        'source_snapshot_id',p_snapshot_id,
        'source_player_id',p_player_id,
        'resolution_method','e-mc-01b-structural-organization-created',
        'organization_ref',v_org_ref,
        'organization_team_ids',to_jsonb(v_team_ids),
        'display_name_source_team_id',v_evidence_team_id,
        'public_club_uid_status','unknown'
      )
    )
    returning id into v_club;
  end if;

  foreach v_team in array v_team_ids loop
    select * into v_existing
    from public.club_structural_team_link_evidence e
    where e.save_id=p_save_id
      and e.owner_id=p_owner_id
      and e.structural_team_id=v_team
      and e.evidence_key=v_evidence_key
    limit 1
    for update;

    if found then
      if v_existing.evidence_status<>'confirmed'
         or v_existing.club_id is distinct from v_club
         or v_existing.organization_ref is distinct from v_org_ref
         or v_existing.organization_team_ids is distinct from v_team_ids
      then
        raise exception 'E-MC-01B same-source structural evidence conflict for Team %', v_team;
      end if;
    else
      insert into public.club_structural_team_link_evidence(
        save_id,owner_id,structural_team_id,club_id,evidence_status,evidence_key,
        organization_ref,organization_team_ids,display_name_raw,
        source_import_id,source_snapshot_id,source_player_id,source_kind,provenance
      )
      values(
        p_save_id,p_owner_id,v_team,v_club,'confirmed',v_evidence_key,
        v_org_ref,v_team_ids,v_evidence_name,
        p_import_id,p_snapshot_id,p_player_id,'fm',
        jsonb_build_object(
          'resolution_method','membership_facts_v1_confirmed_organization',
          'membership_facts_sync_version','e-mc-01b-v1',
          'display_name_source_team_id',v_evidence_team_id,
          'display_name_status',v_evidence_name_status,
          'public_club_uid_status','unknown'
        )
      );
    end if;

    perform public.datatracker_rebuild_structural_team_link(p_save_id,p_owner_id,v_team);
  end loop;

  return jsonb_build_object(
    'status','confirmed',
    'reason_code',case when v_candidate_count=1 then 'unique_structural_registry_candidate' else 'created_from_safe_structural_name_evidence' end,
    'club_id',v_club,
    'organization_ref',v_org_ref,
    'structural_team_ids',to_jsonb(v_team_ids)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Phase0E surgical reconciliation (preserve evidence, remove false authority)
-- ---------------------------------------------------------------------------

with legacy_clubs as (
  select
    c.id,c.save_id,c.owner_id,c.fm_club_id,c.name,c.provenance,
    coalesce(
      nullif(c.provenance->>'resolution_method',''),
      nullif(c.provenance->'fm_identity'->>'resolution_method','')
    ) as legacy_method,
    coalesce(
      nullif(c.provenance->>'source_import_id',''),
      nullif(c.provenance->'fm_identity'->>'source_import_id','')
    ) as legacy_import_text,
    coalesce(
      nullif(c.provenance->>'source_snapshot_id',''),
      nullif(c.provenance->'fm_identity'->>'source_snapshot_id','')
    ) as legacy_snapshot_text
  from public.clubs c
  where c.fm_club_id ~ '^[0-9]+$'
    and c.fm_club_id::bigint > 0
    and c.fm_club_id::bigint < 100000
    and coalesce(
      nullif(c.provenance->>'resolution_method',''),
      nullif(c.provenance->'fm_identity'->>'resolution_method','')
    ) in (
      'confirmed_fm_current_contract_team',
      'confirmed_current_loan_from_team',
      'confirmed_current_loan_to_team'
    )
), resolved_sources as (
  select
    lc.*,
    i.id as source_import_id,
    ps.id as source_snapshot_id,
    ps.player_id as source_player_id
  from legacy_clubs lc
  left join public.imports i
    on i.save_id=lc.save_id and i.id::text=lc.legacy_import_text
  left join public.player_snapshots ps
    on ps.save_id=lc.save_id and ps.id::text=lc.legacy_snapshot_text
)
insert into public.club_structural_team_link_evidence(
  save_id,owner_id,structural_team_id,club_id,evidence_status,evidence_key,
  organization_ref,organization_team_ids,display_name_raw,
  source_import_id,source_snapshot_id,source_player_id,source_kind,provenance
)
select
  rs.save_id,rs.owner_id,rs.fm_club_id::integer,rs.id,'legacy_candidate',
  'legacy-club:'||rs.id::text,
  null,array[rs.fm_club_id::integer],rs.name,
  rs.source_import_id,rs.source_snapshot_id,rs.source_player_id,'legacy',
  jsonb_build_object(
    'resolution_method','phase0e_raw_team_id_reclassified_as_legacy_candidate',
    'legacy_method',rs.legacy_method,
    'legacy_fm_club_id',rs.fm_club_id,
    'original_club_provenance',rs.provenance,
    'public_club_uid_status','unknown'
  )
from resolved_sources rs
on conflict(save_id,structural_team_id,evidence_key) do nothing;

with legacy_clubs as (
  select
    c.id,c.fm_club_id,c.provenance,
    coalesce(
      nullif(c.provenance->>'resolution_method',''),
      nullif(c.provenance->'fm_identity'->>'resolution_method','')
    ) as legacy_method
  from public.clubs c
  where c.fm_club_id ~ '^[0-9]+$'
    and c.fm_club_id::bigint > 0
    and c.fm_club_id::bigint < 100000
    and coalesce(
      nullif(c.provenance->>'resolution_method',''),
      nullif(c.provenance->'fm_identity'->>'resolution_method','')
    ) in (
      'confirmed_fm_current_contract_team',
      'confirmed_current_loan_from_team',
      'confirmed_current_loan_to_team'
    )
)
update public.clubs c
set
  provenance=c.provenance||jsonb_build_object(
    'emc01b_legacy_reconciliation',jsonb_build_object(
      'status','legacy_phase0e_structural_team_candidate',
      'original_fm_club_id',lc.fm_club_id,
      'legacy_resolution_method',lc.legacy_method,
      'reconciled_by','e-mc-01b-v1',
      'public_club_uid_status','unknown'
    )
  ),
  fm_club_id=null,
  updated_at=now()
from legacy_clubs lc
where c.id=lc.id;

do $$
declare
  v record;
begin
  for v in
    select distinct e.save_id,e.owner_id,e.structural_team_id
    from public.club_structural_team_link_evidence e
    where e.evidence_status='legacy_candidate'
      and e.provenance->>'resolution_method'='phase0e_raw_team_id_reclassified_as_legacy_candidate'
  loop
    perform public.datatracker_rebuild_structural_team_link(v.save_id,v.owner_id,v.structural_team_id);
  end loop;
end
$$;

update public.player_memberships pm
set provenance=pm.provenance||jsonb_build_object(
  'legacy_phase0e_untrusted',true,
  'membership_authority','legacy_phase0e_untrusted',
  'legacy_phase0e_original',jsonb_build_object(
    'current_club_id',pm.current_club_id,
    'owner_club_id',pm.owner_club_id,
    'team_level',pm.team_level,
    'squad_name',pm.squad_name,
    'is_loan',pm.is_loan,
    'loan_from_club_id',pm.loan_from_club_id,
    'loan_to_club_id',pm.loan_to_club_id,
    'provenance',pm.provenance
  ),
  'legacy_reconciliation_version','e-mc-01b-v1'
)
where pm.source_kind='fm'
  and pm.provenance ? 'club_resolution_method'
  and pm.provenance ? 'owner_resolution_method'
  and pm.provenance ? 'team_level_resolution_method'
  and coalesce(pm.provenance->>'membership_facts_sync_version','')<>'e-mc-01b-v1';

-- ---------------------------------------------------------------------------
-- 3. Phase0E import trigger replacement: FM legacy fields are never authoritative
-- ---------------------------------------------------------------------------

create or replace function public.sync_longitudinal_import()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_snapshot record;
  v_source_kind text;
  v_current_club_id uuid;
  v_team_level text;
  v_season_label text;
  v_intake_club_id uuid;
  v_intake_class_id uuid;
  v_unresolved integer;
  v_club_count integer;
  v_membership_count integer;
  v_all_csv boolean;
  v_club_match_count integer;
begin
  if new.status<>'imported' then return new; end if;
  if tg_op='UPDATE' and old.status='imported' then return new; end if;

  -- Explicit season labels only. Never infer a season from a date.
  for v_season_label in
    select distinct label
    from (
      select coalesce(nullif(st.season,''),nullif(st.normalized_stats->>'season','')) as label
      from public.player_stats st
      where st.import_id=new.id and st.save_id=new.save_id
    ) q
    where nullif(btrim(label),'') is not null
  loop
    insert into public.seasons(
      save_id,owner_id,season_key,label,source_kind,source_import_id,provenance
    )
    values(
      new.save_id,new.owner_id,'label:'||md5(v_season_label),v_season_label,
      'csv',new.id,
      jsonb_build_object(
        'source_import_id',new.id,
        'source_field','player_stats.season|normalized_stats.season',
        'raw_label',v_season_label,
        'resolution_method','explicit_import_label',
        'dates_status','unknown'
      )
    )
    on conflict(save_id,season_key) do nothing;
  end loop;

  for v_snapshot in
    select ps.*,p.owner_id as player_owner_id
    from public.player_snapshots ps
    join public.players p on p.id=ps.player_id and p.save_id=ps.save_id
    where ps.import_id=new.id and ps.save_id=new.save_id
    order by ps.id
  loop
    v_source_kind := case when v_snapshot.normalized_data->>'source'='fm26-save-offline' then 'fm' else 'csv' end;
    v_current_club_id := null;
    v_team_level := 'unknown';

    if v_source_kind='csv' then
      -- Preserve Phase0E's conservative CSV tracked-club display-label bridge.
      -- This is not a Structural Team identity resolver and never creates Clubs.
      v_club_match_count := 0;
      if nullif(btrim(v_snapshot.club),'') is not null then
        select count(*) into v_club_match_count
        from public.save_clubs sc
        join public.clubs c
          on c.id=sc.club_id and c.save_id=sc.save_id and c.owner_id=sc.owner_id
        where sc.save_id=new.save_id
          and sc.owner_id=new.owner_id
          and sc.is_active
          and c.normalized_name=public.datatracker_normalize_longitudinal_name(v_snapshot.club);

        if v_club_match_count=1 then
          select c.id into v_current_club_id
          from public.save_clubs sc
          join public.clubs c
            on c.id=sc.club_id and c.save_id=sc.save_id and c.owner_id=sc.owner_id
          where sc.save_id=new.save_id
            and sc.owner_id=new.owner_id
            and sc.is_active
            and c.normalized_name=public.datatracker_normalize_longitudinal_name(v_snapshot.club)
          limit 1;
        end if;
      end if;
      if v_snapshot.team_level in ('first_team','reserve','academy','other') then
        v_team_level := v_snapshot.team_level;
      end if;
    end if;

    insert into public.player_memberships(
      save_id,owner_id,player_id,observed_date,current_club_id,owner_club_id,
      team_level,squad_name,is_loan,loan_from_club_id,loan_to_club_id,
      source_snapshot_id,source_import_id,source_kind,provenance
    )
    values(
      new.save_id,new.owner_id,v_snapshot.player_id,v_snapshot.snapshot_date,
      v_current_club_id,null,v_team_level,v_snapshot.squad,
      null,null,null,
      v_snapshot.id,new.id,v_source_kind,
      case when v_source_kind='fm' then
        jsonb_build_object(
          'source_import_id',new.id,
          'source_snapshot_id',v_snapshot.id,
          'raw_club_label',v_snapshot.club,
          'raw_squad_label',v_snapshot.squad,
          'membership_authority','awaiting_membership_facts_v1',
          'legacy_fallback_disabled',true,
          'current_resolution_method','membership_facts_v1_required',
          'owner_resolution_method','membership_facts_v1_required',
          'loan_resolution_method','membership_facts_v1_required',
          'team_level_resolution_method','membership_facts_v1_required'
        )
      else
        jsonb_build_object(
          'source_import_id',new.id,
          'source_snapshot_id',v_snapshot.id,
          'raw_club_label',v_snapshot.club,
          'raw_squad_label',v_snapshot.squad,
          'membership_authority','csv_observation',
          'current_fact_contract','checkpoint-exact-v1',
          'club_resolution_method',case
            when v_current_club_id is not null then 'unique_normalized_tracked_club_match'
            when v_club_match_count>1 then 'ambiguous_normalized_tracked_club_match'
            else 'unresolved'
          end,
          'team_level_resolution_method',case when v_team_level<>'unknown' then 'explicit_snapshot_team_level' else 'unresolved' end,
          'factual_fields',jsonb_build_object(
            'current_organization',jsonb_build_object(
              'status',case when v_current_club_id is not null then 'confirmed' when v_club_match_count>1 then 'ambiguous' else 'unknown' end,
              'reason_code',case when v_current_club_id is not null then 'unique_normalized_tracked_club_match' when v_club_match_count>1 then 'multiple_normalized_tracked_club_matches' else 'tracked_club_match_not_found' end,
              'binding_status',case when v_current_club_id is not null then 'confirmed' when v_club_match_count>1 then 'ambiguous' else 'unknown' end,
              'evidence_refs',jsonb_build_array('player_snapshots:'||v_snapshot.id::text)
            ),
            'owner_organization',jsonb_build_object('status','unknown','reason_code','csv_does_not_establish_owner','evidence_refs','[]'::jsonb),
            'team_level',jsonb_build_object(
              'status',case when v_team_level<>'unknown' then 'confirmed' else 'unknown' end,
              'reason_code',case when v_team_level<>'unknown' then 'explicit_snapshot_team_level' else 'snapshot_team_level_unresolved' end,
              'evidence_refs',jsonb_build_array('player_snapshots:'||v_snapshot.id::text)
            ),
            'structural_squad',jsonb_build_object(
              'status',case when nullif(btrim(v_snapshot.squad),'') is not null then 'confirmed' else 'unknown' end,
              'reason_code',case when nullif(btrim(v_snapshot.squad),'') is not null then 'explicit_snapshot_squad_label' else 'snapshot_squad_unresolved' end,
              'evidence_refs',jsonb_build_array('player_snapshots:'||v_snapshot.id::text)
            ),
            'is_loan',jsonb_build_object('status','unknown','reason_code','csv_does_not_establish_loan','evidence_refs','[]'::jsonb),
            'loan_from_organization',jsonb_build_object('status','unknown','reason_code','csv_does_not_establish_loan_from','evidence_refs','[]'::jsonb),
            'loan_to_organization',jsonb_build_object('status','unknown','reason_code','csv_does_not_establish_loan_to','evidence_refs','[]'::jsonb)
          )
        )
      end
    )
    on conflict(player_id,observed_date,source_snapshot_id)
      where source_snapshot_id is not null
    do nothing;
  end loop;

  -- Preserve direct CSV intake class behavior. FM observations remain unresolved
  -- until membership_facts_v1 is synchronized and therefore cannot create a class here.
  select
    count(*),
    count(*) filter(where pm.current_club_id is null),
    count(distinct pm.current_club_id) filter(where pm.current_club_id is not null),
    min(pm.current_club_id::text)::uuid,
    coalesce(bool_and(pm.source_kind='csv'),false)
  into v_membership_count,v_unresolved,v_club_count,v_intake_club_id,v_all_csv
  from public.player_memberships pm
  where pm.source_import_id=new.id and pm.save_id=new.save_id;

  if new.file_type='intake'
     and v_membership_count>0
     and v_unresolved=0
     and v_club_count=1
     and v_all_csv
     and exists(
       select 1 from public.save_clubs sc
       where sc.save_id=new.save_id and sc.owner_id=new.owner_id
         and sc.club_id=v_intake_club_id and sc.is_active
     )
  then
    insert into public.intake_classes(
      save_id,owner_id,club_id,class_key,label,intake_date,
      source_import_id,source_kind,provenance
    )
    values(
      new.save_id,new.owner_id,v_intake_club_id,
      'intake:'||new.snapshot_date::text,
      'Intake '||new.snapshot_date::text,
      new.snapshot_date,new.id,'csv',
      jsonb_build_object('source_import_id',new.id,'resolution_method','single_tracked_club_direct_csv_intake')
    )
    on conflict(save_id,club_id,class_key) do nothing;

    select ic.id into v_intake_class_id
    from public.intake_classes ic
    where ic.save_id=new.save_id
      and ic.club_id=v_intake_club_id
      and ic.class_key='intake:'||new.snapshot_date::text
    limit 1;

    insert into public.intake_class_members(
      intake_class_id,save_id,owner_id,player_id,baseline_snapshot_id,
      membership_status,source_import_id,source_kind,provenance
    )
    select
      v_intake_class_id,new.save_id,new.owner_id,pm.player_id,pm.source_snapshot_id,
      'confirmed',new.id,'csv',
      jsonb_build_object(
        'source_import_id',new.id,
        'source_snapshot_id',pm.source_snapshot_id,
        'resolution_method','direct_csv_intake_import_membership'
      )
    from public.player_memberships pm
    where pm.source_import_id=new.id
      and pm.save_id=new.save_id
      and pm.source_snapshot_id is not null
    on conflict(intake_class_id,player_id) do nothing;
  end if;

  update public.imports
  set parser_profile=case
        when parser_profile in ('integrity-v1','integrity-v2-longitudinal') then 'integrity-v3-emc01b'
        else parser_profile
      end,
      source_schema=coalesce(source_schema,'{}'::jsonb)||jsonb_build_object(
        'longitudinal_sync_version','phase0e-v2-emc01b-guard'
      )
  where id=new.id and save_id=new.save_id;

  return new;
end
$$;

revoke execute on function public.sync_longitudinal_import() from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 4. membership_facts_v1 -> normalized factual domain sync
-- ---------------------------------------------------------------------------

create or replace function public.datatracker_sync_fm_membership_rows(
  p_save_id uuid,
  p_import_id uuid,
  p_snapshot_date date,
  p_membership_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner uuid := auth.uid();
  v_import public.imports%rowtype;
  v_row jsonb;
  v_fm_id text;
  v_player uuid;
  v_snapshot uuid;
  v_match_count integer;
  v_existing public.player_memberships%rowtype;
  v_has_existing boolean := false;
  v_digest text;
  v_owner_binding jsonb := '{}'::jsonb;
  v_current_binding jsonb := '{}'::jsonb;
  v_identity_binding jsonb := '{}'::jsonb;
  v_loan_from_binding jsonb := '{}'::jsonb;
  v_loan_to_binding jsonb := '{}'::jsonb;
  v_owner_club uuid;
  v_current_club uuid;
  v_loan_from_club uuid;
  v_loan_to_club uuid;
  v_is_loan boolean;
  v_team_level text;
  v_squad_name text;
  v_expiry date;
  v_existing_expiry date;
  v_synced integer := 0;
  v_idempotent integer := 0;
  v_input_count integer := 0;
  v_distinct_players integer := 0;
  v_legacy_original jsonb;
  v_provenance jsonb;
begin
  if v_owner is null then raise exception 'Usuário não autenticado'; end if;
  if p_membership_rows is null or jsonb_typeof(p_membership_rows)<>'array' then
    raise exception 'E-MC-01B membership payload inválido';
  end if;

  select * into v_import
  from public.imports i
  where i.id=p_import_id and i.save_id=p_save_id and i.owner_id=v_owner
  limit 1
  for update;
  if not found then raise exception 'E-MC-01B import não encontrado'; end if;
  if v_import.status<>'imported' then raise exception 'E-MC-01B import ainda não está imported'; end if;
  if v_import.snapshot_date is distinct from p_snapshot_date then
    raise exception 'E-MC-01B checkpoint diverge da data persistida do import';
  end if;

  v_input_count := jsonb_array_length(p_membership_rows);
  if v_input_count=0 then
    return jsonb_build_object('sync_version','e-mc-01b-v1','synced_rows',0,'idempotent_rows',0,'status','no_membership_rows');
  end if;

  select count(distinct nullif(value->>'fm_player_id','')) into v_distinct_players
  from jsonb_array_elements(p_membership_rows) as payload(value);
  if v_distinct_players<>v_input_count then
    raise exception 'E-MC-01B membership payload contém FM IDs ausentes ou duplicados';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('emc01b:'||p_save_id::text,0));

  for v_row in select value from jsonb_array_elements(p_membership_rows) as payload(value) loop
    if v_row->>'facts_schema'<>'membership_facts_v1'
       or v_row->>'facts_version'<>'e-mc-01-v1'
       or v_row->>'sync_version'<>'e-mc-01b-v1'
    then
      raise exception 'E-MC-01B membership envelope version incompatível';
    end if;
    if nullif(v_row->>'checkpoint_date','')::date is distinct from p_snapshot_date then
      raise exception 'E-MC-01B membership checkpoint diverge do import';
    end if;

    v_fm_id := nullif(v_row->>'fm_player_id','');
    select
      count(*),
      min(p.id::text)::uuid,
      min(ps.id::text)::uuid
    into v_match_count,v_player,v_snapshot
    from public.players p
    join public.player_snapshots ps
      on ps.player_id=p.id and ps.save_id=p.save_id
    where p.save_id=p_save_id
      and p.owner_id=v_owner
      and p.fm_player_id=v_fm_id
      and ps.import_id=p_import_id
      and ps.snapshot_date=p_snapshot_date;

    if v_match_count<>1 or v_player is null or v_snapshot is null then
      raise exception 'E-MC-01B FM identity % não resolve unicamente ao snapshot do import',v_fm_id;
    end if;

    v_digest := md5(v_row::text);
    select * into v_existing
    from public.player_memberships pm
    where pm.save_id=p_save_id
      and pm.owner_id=v_owner
      and pm.player_id=v_player
      and pm.observed_date=p_snapshot_date
      and pm.source_snapshot_id=v_snapshot
    limit 1
    for update;
    v_has_existing := found;

    if v_has_existing and v_existing.provenance->>'membership_facts_sync_version'='e-mc-01b-v1' then
      if v_existing.provenance->>'membership_facts_digest'=v_digest then
        v_idempotent := v_idempotent+1;
        continue;
      end if;
      raise exception 'E-MC-01B same-source membership facts conflict for FM ID %',v_fm_id;
    end if;

    if v_has_existing
       and coalesce(v_existing.provenance->>'legacy_phase0e_untrusted','false')<>'true'
       and coalesce(v_existing.provenance->>'membership_authority','')<>'awaiting_membership_facts_v1'
    then
      raise exception 'E-MC-01B existing membership row has non-replaceable authority for FM ID %',v_fm_id;
    end if;

    v_owner_binding := '{}'::jsonb;
    v_current_binding := '{}'::jsonb;
    v_identity_binding := '{}'::jsonb;
    v_loan_from_binding := '{}'::jsonb;
    v_loan_to_binding := '{}'::jsonb;

    if v_row->'owner_organization'->>'status'='confirmed' then
      v_owner_binding := public.datatracker_bind_structural_organization(
        p_save_id,v_owner,p_import_id,v_snapshot,v_player,v_row->'owner_organization'->'value'
      );
    end if;
    if v_row->'current_organization'->>'status'='confirmed' then
      v_current_binding := public.datatracker_bind_structural_organization(
        p_save_id,v_owner,p_import_id,v_snapshot,v_player,v_row->'current_organization'->'value'
      );
    end if;
    if v_row->'organization_identity'->>'status'='confirmed' then
      v_identity_binding := public.datatracker_bind_structural_organization(
        p_save_id,v_owner,p_import_id,v_snapshot,v_player,v_row->'organization_identity'->'value'
      );
    end if;
    if v_row->'loan_from_organization'->>'status'='confirmed' then
      v_loan_from_binding := public.datatracker_bind_structural_organization(
        p_save_id,v_owner,p_import_id,v_snapshot,v_player,v_row->'loan_from_organization'->'value'
      );
    end if;
    if v_row->'loan_to_organization'->>'status'='confirmed' then
      v_loan_to_binding := public.datatracker_bind_structural_organization(
        p_save_id,v_owner,p_import_id,v_snapshot,v_player,v_row->'loan_to_organization'->'value'
      );
    end if;

    v_owner_club := case when v_owner_binding->>'status'='confirmed' then nullif(v_owner_binding->>'club_id','')::uuid else null end;
    v_current_club := case when v_current_binding->>'status'='confirmed' then nullif(v_current_binding->>'club_id','')::uuid else null end;
    v_loan_from_club := case when v_loan_from_binding->>'status'='confirmed' then nullif(v_loan_from_binding->>'club_id','')::uuid else null end;
    v_loan_to_club := case when v_loan_to_binding->>'status'='confirmed' then nullif(v_loan_to_binding->>'club_id','')::uuid else null end;

    v_is_loan := case
      when v_row->'is_loan'->>'status'='confirmed' and jsonb_typeof(v_row->'is_loan'->'value')='boolean'
        then (v_row->'is_loan'->>'value')::boolean
      else null
    end;
    v_team_level := case
      when v_row->'team_level'->>'status'='confirmed' and v_row->'team_level'->>'value'='first_team'
        then 'first_team'
      else 'unknown'
    end;
    v_squad_name := nullif(v_row->'raw_structural_membership'->>'roster_group_label_raw','');

    v_legacy_original := case
      when v_has_existing then v_existing.provenance->'legacy_phase0e_original'
      else null
    end;

    v_provenance := jsonb_build_object(
      'source_import_id',p_import_id,
      'source_snapshot_id',v_snapshot,
      'membership_authority','membership_facts_v1',
      'membership_facts_schema','membership_facts_v1',
      'membership_facts_version','e-mc-01-v1',
      'membership_facts_sync_version','e-mc-01b-v1',
      'membership_facts_digest',v_digest,
      'legacy_phase0e_untrusted',false,
      'raw_structural_membership',coalesce(v_row->'raw_structural_membership','{}'::jsonb),
      'raw_squad_label',v_squad_name,
      'factual_fields',jsonb_build_object(
        'organization_identity',jsonb_build_object(
          'status',v_row->'organization_identity'->>'status',
          'reason_code',v_row->'organization_identity'->>'reason_code',
          'evidence_refs',coalesce(v_row->'organization_identity'->'evidence_refs','[]'::jsonb),
          'organization_ref',v_row#>>'{organization_identity,value,organization_ref}',
          'binding_status',coalesce(v_identity_binding->>'status','not_applicable'),
          'binding_reason_code',v_identity_binding->>'reason_code'
        ),
        'current_organization',jsonb_build_object(
          'status',v_row->'current_organization'->>'status',
          'reason_code',v_row->'current_organization'->>'reason_code',
          'evidence_refs',coalesce(v_row->'current_organization'->'evidence_refs','[]'::jsonb),
          'organization_ref',v_row#>>'{current_organization,value,organization_ref}',
          'binding_status',coalesce(v_current_binding->>'status','not_applicable'),
          'binding_reason_code',v_current_binding->>'reason_code',
          'club_id',v_current_club
        ),
        'owner_organization',jsonb_build_object(
          'status',v_row->'owner_organization'->>'status',
          'reason_code',v_row->'owner_organization'->>'reason_code',
          'evidence_refs',coalesce(v_row->'owner_organization'->'evidence_refs','[]'::jsonb),
          'organization_ref',v_row#>>'{owner_organization,value,organization_ref}',
          'binding_status',coalesce(v_owner_binding->>'status','not_applicable'),
          'binding_reason_code',v_owner_binding->>'reason_code',
          'club_id',v_owner_club
        ),
        'is_loan',jsonb_build_object(
          'status',v_row->'is_loan'->>'status',
          'reason_code',v_row->'is_loan'->>'reason_code',
          'evidence_refs',coalesce(v_row->'is_loan'->'evidence_refs','[]'::jsonb)
        ),
        'loan_from_organization',jsonb_build_object(
          'status',v_row->'loan_from_organization'->>'status',
          'reason_code',v_row->'loan_from_organization'->>'reason_code',
          'evidence_refs',coalesce(v_row->'loan_from_organization'->'evidence_refs','[]'::jsonb),
          'organization_ref',v_row#>>'{loan_from_organization,value,organization_ref}',
          'binding_status',coalesce(v_loan_from_binding->>'status','not_applicable'),
          'binding_reason_code',v_loan_from_binding->>'reason_code',
          'club_id',v_loan_from_club
        ),
        'loan_to_organization',jsonb_build_object(
          'status',v_row->'loan_to_organization'->>'status',
          'reason_code',v_row->'loan_to_organization'->>'reason_code',
          'evidence_refs',coalesce(v_row->'loan_to_organization'->'evidence_refs','[]'::jsonb),
          'organization_ref',v_row#>>'{loan_to_organization,value,organization_ref}',
          'binding_status',coalesce(v_loan_to_binding->>'status','not_applicable'),
          'binding_reason_code',v_loan_to_binding->>'reason_code',
          'club_id',v_loan_to_club
        ),
        'team_level',jsonb_build_object(
          'status',v_row->'team_level'->>'status',
          'reason_code',v_row->'team_level'->>'reason_code',
          'evidence_refs',coalesce(v_row->'team_level'->'evidence_refs','[]'::jsonb)
        ),
        'structural_squad',jsonb_build_object(
          'status',v_row->'structural_squad'->>'status',
          'reason_code',v_row->'structural_squad'->>'reason_code',
          'evidence_refs',coalesce(v_row->'structural_squad'->'evidence_refs','[]'::jsonb)
        )
      ),
      'contract_facts',coalesce(v_row->'contract_facts','{}'::jsonb)
    );
    if v_legacy_original is not null then
      v_provenance := v_provenance||jsonb_build_object('legacy_phase0e_original',v_legacy_original);
    end if;

    if v_has_existing then
      update public.player_memberships
      set
        current_club_id=v_current_club,
        owner_club_id=v_owner_club,
        team_level=v_team_level,
        squad_name=v_squad_name,
        is_loan=v_is_loan,
        loan_from_club_id=v_loan_from_club,
        loan_to_club_id=v_loan_to_club,
        source_import_id=p_import_id,
        source_kind='fm',
        provenance=v_provenance
      where id=v_existing.id;
    else
      insert into public.player_memberships(
        save_id,owner_id,player_id,observed_date,current_club_id,owner_club_id,
        team_level,squad_name,is_loan,loan_from_club_id,loan_to_club_id,
        source_snapshot_id,source_import_id,source_kind,provenance
      )
      values(
        p_save_id,v_owner,v_player,p_snapshot_date,v_current_club,v_owner_club,
        v_team_level,v_squad_name,v_is_loan,v_loan_from_club,v_loan_to_club,
        v_snapshot,p_import_id,'fm',v_provenance
      );
    end if;

    v_expiry := null;
    if v_row#>>'{contract_facts,current_standard_contract,status}'='confirmed'
       and v_row#>>'{contract_facts,contract_expiry,status}'='confirmed'
       and coalesce(v_row#>>'{contract_facts,contract_expiry,value}','') ~ '^\d{4}-\d{2}-\d{2}$'
    then
      if nullif(v_row#>>'{contract_facts,current_standard_contract,value,expiry_date}','') is not null
         and v_row#>>'{contract_facts,current_standard_contract,value,expiry_date}'
             is distinct from v_row#>>'{contract_facts,contract_expiry,value}'
      then
        raise exception 'E-MC-01B current-contract expiry facts conflict for FM ID %',v_fm_id;
      end if;
      v_expiry := (v_row#>>'{contract_facts,contract_expiry,value}')::date;
      v_existing_expiry := null;
      select c.expiry_date into v_existing_expiry
      from public.contracts c
      where c.player_id=v_player and c.snapshot_date=p_snapshot_date
      limit 1
      for update;
      if found and v_existing_expiry is not null and v_existing_expiry is distinct from v_expiry then
        raise exception 'E-MC-01B confirmed contract expiry conflicts with existing contract for FM ID % at %',v_fm_id,p_snapshot_date;
      end if;
      insert into public.contracts(player_id,owner_id,snapshot_date,expiry_date)
      values(v_player,v_owner,p_snapshot_date,v_expiry)
      on conflict(player_id,snapshot_date)
      do update set expiry_date=coalesce(public.contracts.expiry_date,excluded.expiry_date);
    end if;

    v_synced := v_synced+1;
  end loop;

  update public.imports i
  set source_schema=coalesce(i.source_schema,'{}'::jsonb)||jsonb_build_object(
    'membership_facts_sync_version','e-mc-01b-v1',
    'membership_facts_synced_rows',v_synced,
    'membership_facts_idempotent_rows',v_idempotent
  )
  where i.id=p_import_id and i.save_id=p_save_id and i.owner_id=v_owner;

  return jsonb_build_object(
    'sync_version','e-mc-01b-v1',
    'synced_rows',v_synced,
    'idempotent_rows',v_idempotent,
    'status','synced'
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Transactional import RPC: canonical 9-param implementation + 8-param wrapper
-- ---------------------------------------------------------------------------

create or replace function public.import_fm_export(
  p_save_id uuid,
  p_filename text,
  p_file_type text,
  p_snapshot_date date,
  p_file_hash text,
  p_delimiter text,
  p_warnings jsonb,
  p_rows jsonb,
  p_membership_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=''
set statement_timeout='120s'
as $$
declare
  v_owner uuid := auth.uid();
  v_import uuid;
  v_existing_import public.imports%rowtype;
  v_row jsonb;
  v_player uuid;
  v_snapshot uuid;
  v_attr jsonb;
  v_stats jsonb;
  v_new integer := 0;
  v_updated integer := 0;
  v_incoming_fm text;
  v_name text;
  v_dob date;
  v_candidate_count integer;
  v_has_later_squad boolean := false;
  v_is_latest_squad boolean := false;
  v_should_mark_active boolean := false;
  v_is_fm_only_row boolean := false;
  v_membership_row jsonb;
  v_snapshot_contract_expiry date;
  v_membership_sync jsonb := '{}'::jsonb;
begin
  if v_owner is null then raise exception 'Usuário não autenticado'; end if;
  if not exists(select 1 from public.saves where id=p_save_id and owner_id=v_owner) then raise exception 'Save não encontrado'; end if;
  if p_snapshot_date is null then raise exception 'Data do snapshot é obrigatória'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'Importação sem jogadores'; end if;
  if p_membership_rows is null or jsonb_typeof(p_membership_rows)<>'array' then raise exception 'E-MC-01B membership payload inválido'; end if;

  select * into v_existing_import
  from public.imports i
  where i.save_id=p_save_id and i.owner_id=v_owner and i.file_hash=p_file_hash
  order by i.created_at,i.id
  limit 1
  for update;

  if found then
    if v_existing_import.status<>'imported' then raise exception 'Import duplicado existente não está em estado imported'; end if;
    if v_existing_import.snapshot_date is distinct from p_snapshot_date then raise exception 'Mesmo hash com data de snapshot divergente'; end if;
    if v_existing_import.file_type is distinct from p_file_type then raise exception 'Mesmo hash com tipo de import divergente'; end if;
    v_membership_sync := public.datatracker_sync_fm_membership_rows(
      p_save_id,v_existing_import.id,p_snapshot_date,p_membership_rows
    );
    return jsonb_build_object(
      'duplicate',true,
      'import_id',v_existing_import.id,
      'new_players',0,
      'updated_players',0,
      'membership_sync',v_membership_sync
    );
  end if;

  select exists(
    select 1 from public.imports
    where save_id=p_save_id and file_type='squad' and status='imported' and snapshot_date>p_snapshot_date
  ) into v_has_later_squad;
  v_is_latest_squad := p_file_type='squad' and not v_has_later_squad;
  v_should_mark_active := p_file_type in ('squad','intake') and not v_has_later_squad;

  insert into public.imports(
    save_id,owner_id,original_filename,file_type,snapshot_date,file_hash,row_count,
    delimiter,parser_profile,warnings,status
  )
  values(
    p_save_id,v_owner,p_filename,p_file_type,p_snapshot_date,p_file_hash,jsonb_array_length(p_rows),
    p_delimiter,'integrity-v1',coalesce(p_warnings,'[]'::jsonb),'parsed'
  )
  returning id into v_import;

  -- Legacy compatibility only. E-MC-01B factual resolvers never consult is_active.
  if v_is_latest_squad then
    update public.players set is_active=false,updated_at=now()
    where save_id=p_save_id and is_active=true;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as rows(value) loop
    v_player := null;
    v_incoming_fm := nullif(v_row->>'fm_player_id','');
    v_name := nullif(v_row->>'normalized_name','');
    v_dob := nullif(v_row->>'date_of_birth','')::date;
    v_is_fm_only_row := v_row->'normalized_data'->>'import_source'='fm26-offline-beta';
    v_membership_row := null;
    v_snapshot_contract_expiry := null;
    if v_is_fm_only_row and v_incoming_fm is not null then
      select payload.value into v_membership_row
      from jsonb_array_elements(p_membership_rows) as payload(value)
      where payload.value->>'fm_player_id'=v_incoming_fm
      limit 1;
      if v_membership_row#>>'{contract_facts,current_standard_contract,status}'='confirmed'
         and v_membership_row#>>'{contract_facts,contract_expiry,status}'='confirmed'
         and coalesce(v_membership_row#>>'{contract_facts,contract_expiry,value}','') ~ '^\d{4}-\d{2}-\d{2}$'
      then
        v_snapshot_contract_expiry := (v_membership_row#>>'{contract_facts,contract_expiry,value}')::date;
      end if;
    elsif nullif(v_row->>'contract_expiry','') is not null then
      -- CSV and validated CSV+.fm retain the CSV contract-expiry field.
      v_snapshot_contract_expiry := (v_row->>'contract_expiry')::date;
    end if;
    if v_name is null then raise exception 'Linha sem nome normalizado'; end if;

    if v_incoming_fm is not null then
      select count(*) into v_candidate_count
      from public.players
      where save_id=p_save_id and (fm_player_id=v_incoming_fm or identity_key='fm:'||v_incoming_fm);
      if v_candidate_count>1 then
        raise exception 'Identidade FM duplicada no Banco Mestre: %',v_incoming_fm;
      elsif v_candidate_count=1 then
        select id into v_player from public.players
        where save_id=p_save_id and (fm_player_id=v_incoming_fm or identity_key='fm:'||v_incoming_fm)
        limit 1;
      elsif v_dob is not null then
        select count(*) into v_candidate_count
        from public.players
        where save_id=p_save_id and fm_player_id is null and normalized_name=v_name and date_of_birth=v_dob;
        if v_candidate_count>1 then
          raise exception 'Identidade ambígua ao promover % para FM ID %',v_name,v_incoming_fm;
        elsif v_candidate_count=1 then
          select id into v_player from public.players
          where save_id=p_save_id and fm_player_id is null and normalized_name=v_name and date_of_birth=v_dob
          limit 1;
        end if;
      end if;
    else
      if v_dob is not null then
        select count(*) into v_candidate_count from public.players
        where save_id=p_save_id and normalized_name=v_name and date_of_birth=v_dob;
        if v_candidate_count>1 then
          raise exception 'Identidade ambígua por nome+nascimento: % / %',v_name,v_dob;
        elsif v_candidate_count=1 then
          select id into v_player from public.players
          where save_id=p_save_id and normalized_name=v_name and date_of_birth=v_dob limit 1;
        end if;
      else
        select count(*) into v_candidate_count from public.players
        where save_id=p_save_id and normalized_name=v_name;
        if v_candidate_count>1 then
          raise exception 'Identidade ambígua por nome: %',v_name;
        elsif v_candidate_count=1 then
          select id into v_player from public.players where save_id=p_save_id and normalized_name=v_name limit 1;
        end if;
      end if;
    end if;

    if v_player is null then
      insert into public.players(
        save_id,owner_id,fm_player_id,identity_key,current_name,normalized_name,date_of_birth,
        nationality,original_first_seen_name,first_seen_date,last_seen_date,is_active
      )
      values(
        p_save_id,v_owner,v_incoming_fm,
        case when v_incoming_fm is not null then 'fm:'||v_incoming_fm else v_row->>'identity_key' end,
        v_row->>'current_name',v_name,v_dob,v_row->>'nationality',v_row->>'current_name',
        p_snapshot_date,p_snapshot_date,v_should_mark_active
      )
      returning id into v_player;
      v_new := v_new+1;
    else
      update public.players
      set
        fm_player_id=coalesce(v_incoming_fm,fm_player_id),
        identity_key=case when v_incoming_fm is not null then 'fm:'||v_incoming_fm else identity_key end,
        current_name=coalesce(nullif(v_row->>'current_name',''),current_name),
        normalized_name=v_name,
        date_of_birth=coalesce(v_dob,date_of_birth),
        nationality=coalesce(nullif(v_row->>'nationality',''),nationality),
        first_seen_date=least(first_seen_date,p_snapshot_date),
        last_seen_date=greatest(last_seen_date,p_snapshot_date),
        is_active=case when v_should_mark_active then true else is_active end,
        updated_at=now()
      where id=v_player;
      v_updated := v_updated+1;
    end if;

    if p_file_type in ('squad','intake') then
      insert into public.player_snapshots(
        player_id,save_id,import_id,snapshot_date,age,club,squad,positions,
        preferred_foot,height,weight,contract_expiry,raw_data,normalized_data
      )
      values(
        v_player,p_save_id,v_import,p_snapshot_date,
        nullif(v_row->>'age','')::numeric,
        nullif(v_row->>'club',''),
        nullif(v_row->>'squad',''),
        coalesce(v_row->'positions','[]'::jsonb),
        nullif(v_row->>'preferred_foot',''),
        nullif(v_row->>'height','')::numeric,
        nullif(v_row->>'weight','')::numeric,
        v_snapshot_contract_expiry,
        coalesce(v_row->'raw_data','{}'::jsonb)-'membership_facts_v1'-'membership_persistence_v1',
        coalesce(v_row->'normalized_data','{}'::jsonb)-'membership_facts_v1'-'membership_persistence_v1'
      )
      returning id into v_snapshot;

      for v_attr in select value from jsonb_array_elements(coalesce(v_row->'attributes','[]'::jsonb)) as attrs(value) loop
        insert into public.player_attributes(
          player_snapshot_id,attribute_key,attribute_label,value,source_column,category
        )
        values(
          v_snapshot,v_attr->>'attribute_key',v_attr->>'attribute_label',
          (v_attr->>'value')::numeric,v_attr->>'source_column',v_attr->>'category'
        );
      end loop;

      if v_snapshot_contract_expiry is not null and not v_is_fm_only_row then
        insert into public.contracts(player_id,owner_id,snapshot_date,expiry_date)
        values(v_player,v_owner,p_snapshot_date,v_snapshot_contract_expiry)
        on conflict(player_id,snapshot_date) do update set expiry_date=excluded.expiry_date;
      end if;

      v_stats := coalesce(v_row->'statistics',v_row->'normalized_data'->'statistics');
      if v_stats is not null and jsonb_typeof(v_stats)='object' and v_stats<>'{}'::jsonb then
        insert into public.player_stats(
          player_id,save_id,import_id,snapshot_date,minutes,appearances,starts,sub_appearances,
          raw_stats,normalized_stats
        )
        values(
          v_player,p_save_id,v_import,p_snapshot_date,
          nullif(v_stats->>'minutes','')::numeric,
          nullif(coalesce(v_stats->>'total_appearances',v_stats->>'appearances'),'')::numeric,
          nullif(v_stats->>'starts','')::numeric,
          nullif(v_stats->>'sub_appearances','')::numeric,
          v_stats,v_stats
        );
      end if;
    else
      insert into public.player_stats(
        player_id,save_id,import_id,snapshot_date,minutes,appearances,starts,sub_appearances,
        raw_stats,normalized_stats
      )
      values(
        v_player,p_save_id,v_import,p_snapshot_date,
        nullif(v_row->>'minutes','')::numeric,
        nullif(v_row->>'appearances','')::numeric,
        nullif(v_row->>'starts','')::numeric,
        nullif(v_row->>'sub_appearances','')::numeric,
        coalesce(v_row->'raw_data','{}'::jsonb)-'membership_facts_v1'-'membership_persistence_v1',
        coalesce(v_row->'normalized_data','{}'::jsonb)-'membership_facts_v1'-'membership_persistence_v1'
      );
    end if;
  end loop;

  update public.imports set status='imported' where id=v_import and save_id=p_save_id;
  v_membership_sync := public.datatracker_sync_fm_membership_rows(
    p_save_id,v_import,p_snapshot_date,p_membership_rows
  );

  return jsonb_build_object(
    'duplicate',false,
    'import_id',v_import,
    'new_players',v_new,
    'updated_players',v_updated,
    'rows',jsonb_array_length(p_rows),
    'membership_sync',v_membership_sync
  );
end
$$;

-- Backward-compatible wrapper for clients deployed before E-MC-01B.
create or replace function public.import_fm_export(
  p_save_id uuid,
  p_filename text,
  p_file_type text,
  p_snapshot_date date,
  p_file_hash text,
  p_delimiter text,
  p_warnings jsonb,
  p_rows jsonb
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select public.import_fm_export(
    p_save_id,p_filename,p_file_type,p_snapshot_date,p_file_hash,p_delimiter,p_warnings,p_rows,
    coalesce((
      select jsonb_agg(payload.value->'membership_persistence_v1')
      from jsonb_array_elements(p_rows) as payload(value)
      where jsonb_typeof(payload.value->'membership_persistence_v1')='object'
    ),'[]'::jsonb)
  );
$$;

revoke execute on function public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb,jsonb) from public,anon;
revoke execute on function public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb) from public,anon;
revoke execute on function public.datatracker_sync_fm_membership_rows(uuid,uuid,date,jsonb) from public,anon;
revoke execute on function public.datatracker_bind_structural_organization(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon;
revoke execute on function public.datatracker_rebuild_structural_team_link(uuid,uuid,integer) from public,anon;

grant execute on function public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.datatracker_sync_fm_membership_rows(uuid,uuid,date,jsonb) to authenticated,service_role;
grant execute on function public.datatracker_bind_structural_organization(uuid,uuid,uuid,uuid,uuid,jsonb) to authenticated,service_role;
grant execute on function public.datatracker_rebuild_structural_team_link(uuid,uuid,integer) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 6. Import cleanup replacement: structural evidence survives/degrades correctly
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_longitudinal_import()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_team_ids integer[];
  v_team integer;
begin
  select array_agg(distinct e.structural_team_id)
    into v_team_ids
  from public.club_structural_team_link_evidence e
  where e.save_id=old.save_id and e.owner_id=old.owner_id and e.source_import_id=old.id;

  delete from public.club_structural_team_link_evidence e
  where e.save_id=old.save_id and e.owner_id=old.owner_id and e.source_import_id=old.id;

  if v_team_ids is not null then
    foreach v_team in array v_team_ids loop
      perform public.datatracker_rebuild_structural_team_link(old.save_id,old.owner_id,v_team);
    end loop;
  end if;

  delete from public.event_decision_links edl
  using public.save_events se
  where se.id=edl.event_id
    and se.save_id=old.save_id
    and se.source_import_id=old.id;

  delete from public.save_events
  where save_id=old.save_id and source_import_id=old.id and source_kind<>'manual';

  delete from public.intake_class_members
  where save_id=old.save_id and source_import_id=old.id;

  delete from public.intake_classes ic
  where ic.save_id=old.save_id
    and ic.source_import_id=old.id
    and not exists(select 1 from public.intake_class_members m where m.intake_class_id=ic.id);

  delete from public.player_memberships
  where save_id=old.save_id and source_import_id=old.id;

  delete from public.clubs c
  where c.save_id=old.save_id
    and c.owner_id=old.owner_id
    and c.source_import_id=old.id
    and not exists(select 1 from public.save_clubs sc where sc.club_id=c.id)
    and not exists(
      select 1 from public.player_memberships pm
      where pm.current_club_id=c.id or pm.owner_club_id=c.id or pm.loan_from_club_id=c.id or pm.loan_to_club_id=c.id
    )
    and not exists(select 1 from public.intake_classes ic where ic.club_id=c.id)
    and not exists(select 1 from public.save_events se where se.club_id=c.id)
    and not exists(select 1 from public.club_structural_team_links l where l.club_id=c.id)
    and not exists(select 1 from public.club_structural_team_link_evidence e where e.club_id=c.id);

  return old;
end
$$;

revoke execute on function public.cleanup_longitudinal_import() from public,anon,authenticated;

-- Existing trigger names already point at sync_longitudinal_import/cleanup_longitudinal_import;
-- recreate them explicitly so upgrade and clean paths converge.
drop trigger if exists sync_longitudinal_import_on_insert on public.imports;
create trigger sync_longitudinal_import_on_insert
after insert on public.imports
for each row when (new.status='imported')
execute function public.sync_longitudinal_import();

drop trigger if exists sync_longitudinal_import_on_status on public.imports;
create trigger sync_longitudinal_import_on_status
after update of status on public.imports
for each row when (new.status='imported')
execute function public.sync_longitudinal_import();

drop trigger if exists cleanup_longitudinal_import_before_delete on public.imports;
create trigger cleanup_longitudinal_import_before_delete
before delete on public.imports
for each row execute function public.cleanup_longitudinal_import();

-- ---------------------------------------------------------------------------
-- 7. Capability marker
-- ---------------------------------------------------------------------------

create or replace function public.datatracker_schema_info()
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_import_rpc boolean := to_regprocedure('public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb)') is not null;
  v_import_membership_rpc boolean := to_regprocedure('public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb,jsonb)') is not null;
  v_delete_rpc boolean := to_regprocedure('public.delete_fm_import(uuid,uuid)') is not null;
  v_model_patch boolean := to_regprocedure('public.patch_scoring_model_config(uuid,text,text,jsonb)') is not null;
  v_projections boolean := to_regclass('public.player_projections') is not null;
  v_diag_table boolean := to_regclass('public.fm_reader_samples') is not null;
  v_diag_bucket boolean := exists(select 1 from storage.buckets where id='fm-reader-samples' and public=false);
  v_diag_reservation boolean := exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='fm_reader_samples' and column_name='storage_prefix'
  );
  v_diag_retention boolean :=
    exists(select 1 from pg_extension where extname='pg_cron')
    and exists(select 1 from pg_extension where extname='pg_net')
    and exists(select 1 from cron.job where jobname='fm-reader-samples-retention');
  v_longitudinal_core boolean :=
    to_regclass('public.clubs') is not null
    and to_regclass('public.save_clubs') is not null
    and to_regclass('public.seasons') is not null
    and to_regclass('public.player_memberships') is not null
    and to_regclass('public.intake_classes') is not null
    and to_regclass('public.intake_class_members') is not null
    and to_regclass('public.save_events') is not null
    and to_regclass('public.event_decision_links') is not null;
  v_longitudinal_backfill boolean :=
    v_longitudinal_core
    and not exists(
      select 1 from public.saves s
      where nullif(btrim(s.club_name),'') is not null
        and not exists(
          select 1 from public.save_clubs sc
          where sc.save_id=s.id and sc.tracking_role='primary' and sc.is_active
        )
    );
  v_longitudinal_save_structure boolean := to_regprocedure('public.create_save_with_structure(text,text,text)') is not null;
  v_longitudinal_imports boolean :=
    to_regprocedure('public.sync_longitudinal_import()') is not null
    and to_regprocedure('public.cleanup_longitudinal_import()') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.imports'::regclass and tgname='sync_longitudinal_import_on_status' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgrelid='public.imports'::regclass and tgname='cleanup_longitudinal_import_before_delete' and not tgisinternal);
  v_analyzer_stats_context boolean :=
    to_regprocedure('public.datatracker_sync_player_stat_context()') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.player_stats'::regclass and tgname='sync_player_stat_context_before_write' and not tgisinternal);
  v_multiclub_tracking_management boolean :=
    to_regprocedure('public.track_save_club(uuid,uuid)') is not null
    and to_regprocedure('public.create_tracked_club(uuid,text,text)') is not null
    and to_regprocedure('public.set_tracked_club_active(uuid,uuid,boolean)') is not null;
  v_emc01b boolean :=
    to_regclass('public.club_structural_team_links') is not null
    and to_regclass('public.club_structural_team_link_evidence') is not null
    and v_import_membership_rpc
    and to_regprocedure('public.datatracker_sync_fm_membership_rows(uuid,uuid,date,jsonb)') is not null
    and to_regprocedure('public.datatracker_bind_structural_organization(uuid,uuid,uuid,uuid,uuid,jsonb)') is not null;
  v_features text[] := array['schema_version_marker'];
begin
  if v_import_rpc then v_features := array_append(v_features,'import_fm_export'); end if;
  if v_delete_rpc then v_features := array_append(v_features,'delete_fm_import'); end if;
  if v_model_patch then v_features := array_append(v_features,'patch_scoring_model_config'); end if;
  if v_projections then v_features := array_append(v_features,'player_projections_v1'); end if;
  if v_diag_table and v_diag_bucket and v_diag_reservation then v_features := array_append(v_features,'fm_reader_diagnostics_v2'); end if;
  if v_diag_retention then v_features := array_append(v_features,'fm_reader_diagnostics_server_retention'); end if;
  if v_longitudinal_core then v_features := array_append(v_features,'core_longitudinal_domain_v1'); end if;
  if v_longitudinal_backfill then v_features := array_append(v_features,'core_longitudinal_backfill_v1'); end if;
  if v_longitudinal_save_structure then v_features := array_append(v_features,'core_longitudinal_save_structure_v1'); end if;
  if v_longitudinal_imports then v_features := array_append(v_features,'core_longitudinal_imports_v1'); end if;
  if v_analyzer_stats_context then v_features := array_append(v_features,'analyzer_stats_context_v1'); end if;
  if v_multiclub_tracking_management then v_features := array_append(v_features,'multiclub_tracking_management_v1'); end if;
  if v_emc01b then v_features := array_append(v_features,'factual_membership_emc01b_v1'); end if;

  return jsonb_build_object(
    'schema_version','202609030001',
    'app_version','0.29.4',
    'features',to_jsonb(v_features),
    'capabilities',jsonb_build_object(
      'import_rpc',v_import_rpc,
      'delete_import_rpc',v_delete_rpc,
      'model_config_patch',v_model_patch,
      'projections',v_projections,
      'diagnostics_table',v_diag_table,
      'diagnostics_bucket',v_diag_bucket,
      'diagnostics_reservations',v_diag_reservation,
      'diagnostics_upload',v_diag_table and v_diag_bucket and v_diag_reservation,
      'diagnostics_server_retention',v_diag_retention,
      'longitudinal_core',v_longitudinal_core,
      'longitudinal_backfill',v_longitudinal_backfill,
      'longitudinal_save_structure',v_longitudinal_save_structure,
      'longitudinal_imports',v_longitudinal_imports,
      'analyzer_stats_context',v_analyzer_stats_context,
      'multiclub_tracking_management',v_multiclub_tracking_management,
      'factual_membership_emc01b',v_emc01b
    )
  );
end
$$;

comment on table public.club_structural_team_links is
  'E-MC-01B materialized Structural Team ID -> internal Club UUID registry. Structural Team IDs are not public Club UIDs.';
comment on table public.club_structural_team_link_evidence is
  'E-MC-01B source-scoped evidence for Structural Team -> Club bindings; preserves legacy candidates without granting authority.';
comment on function public.datatracker_sync_fm_membership_rows(uuid,uuid,date,jsonb) is
  'E-MC-01B transactional persistence of compact membership_facts_v1 evidence. Only confirmed fields populate normalized membership columns.';
comment on function public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb,jsonb) is
  'E-MC-01B canonical import RPC: snapshot and membership facts commit atomically; duplicate content may enrich an existing source snapshot without creating a new one.';

notify pgrst,'reload schema';

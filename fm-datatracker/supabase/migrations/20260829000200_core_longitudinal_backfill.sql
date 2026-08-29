-- FM DataTracker — Phase 0B
-- Idempotent legacy backfill + FK index hardening.
-- Additive only. Historical snapshots/stats/decisions are never rewritten.

create or replace function public.datatracker_normalize_longitudinal_name(p_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select trim(regexp_replace(
    translate(
      lower(btrim(p_value)),
      'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
      'aaaaaaeeeeiiiiooooouuuucnyy'
    ),
    '[^a-z0-9]+',
    ' ',
    'g'
  ));
$$;

revoke execute on function public.datatracker_normalize_longitudinal_name(text) from public, anon;
grant execute on function public.datatracker_normalize_longitudinal_name(text) to authenticated, service_role;

-- Cover the composite Phase 0A foreign keys in FK-column order.
create index if not exists clubs_save_owner_idx on public.clubs(save_id, owner_id);
create index if not exists clubs_source_import_save_idx on public.clubs(source_import_id, save_id);

create index if not exists save_clubs_save_owner_idx on public.save_clubs(save_id, owner_id);
create index if not exists save_clubs_club_save_owner_idx on public.save_clubs(club_id, save_id, owner_id);

create index if not exists seasons_save_owner_idx on public.seasons(save_id, owner_id);
create index if not exists seasons_source_import_save_idx on public.seasons(source_import_id, save_id);

create index if not exists player_memberships_save_owner_idx on public.player_memberships(save_id, owner_id);
create index if not exists player_memberships_player_save_owner_idx on public.player_memberships(player_id, save_id, owner_id);
create index if not exists player_memberships_season_save_owner_idx on public.player_memberships(season_id, save_id, owner_id);
create index if not exists player_memberships_current_club_save_owner_idx on public.player_memberships(current_club_id, save_id, owner_id);
create index if not exists player_memberships_owner_club_save_owner_idx on public.player_memberships(owner_club_id, save_id, owner_id);
create index if not exists player_memberships_loan_from_club_save_owner_idx on public.player_memberships(loan_from_club_id, save_id, owner_id);
create index if not exists player_memberships_loan_to_club_save_owner_idx on public.player_memberships(loan_to_club_id, save_id, owner_id);
create index if not exists player_memberships_snapshot_player_save_idx on public.player_memberships(source_snapshot_id, player_id, save_id);
create index if not exists player_memberships_import_save_idx on public.player_memberships(source_import_id, save_id);

create index if not exists intake_classes_save_owner_idx on public.intake_classes(save_id, owner_id);
create index if not exists intake_classes_club_save_owner_idx on public.intake_classes(club_id, save_id, owner_id);
create index if not exists intake_classes_season_save_owner_idx on public.intake_classes(season_id, save_id, owner_id);
create index if not exists intake_classes_import_save_idx on public.intake_classes(source_import_id, save_id);

create index if not exists intake_class_members_save_owner_idx on public.intake_class_members(save_id, owner_id);
create index if not exists intake_class_members_class_save_owner_idx on public.intake_class_members(intake_class_id, save_id, owner_id);
create index if not exists intake_class_members_player_save_owner_idx on public.intake_class_members(player_id, save_id, owner_id);
create index if not exists intake_class_members_snapshot_player_save_idx on public.intake_class_members(baseline_snapshot_id, player_id, save_id);
create index if not exists intake_class_members_import_save_idx on public.intake_class_members(source_import_id, save_id);

create index if not exists save_events_save_owner_idx on public.save_events(save_id, owner_id);
create index if not exists save_events_season_save_owner_idx on public.save_events(season_id, save_id, owner_id);
create index if not exists save_events_club_save_owner_idx on public.save_events(club_id, save_id, owner_id);
create index if not exists save_events_player_save_owner_idx on public.save_events(player_id, save_id, owner_id);
create index if not exists save_events_class_save_owner_idx on public.save_events(intake_class_id, save_id, owner_id);
create index if not exists save_events_import_save_idx on public.save_events(source_import_id, save_id);
create index if not exists save_events_snapshot_player_save_idx on public.save_events(source_snapshot_id, player_id, save_id);

create index if not exists event_decision_links_save_owner_idx on public.event_decision_links(save_id, owner_id);
create index if not exists event_decision_links_event_save_owner_idx on public.event_decision_links(event_id, save_id, owner_id);
create index if not exists event_decision_links_decision_save_owner_idx on public.event_decision_links(decision_id, save_id, owner_id);

-- A. Every pre-Phase-0 save gets one active primary Club/SaveClub from the
-- existing saves.club_name value. This is compatibility evidence, not an
-- assertion that later snapshots necessarily belong to that club.
insert into public.clubs(
  save_id, owner_id, name, normalized_name, country, source_kind, provenance
)
select
  s.id,
  s.owner_id,
  s.club_name,
  public.datatracker_normalize_longitudinal_name(s.club_name),
  s.country,
  'legacy',
  jsonb_build_object(
    'backfill_version','phase0b-v1',
    'source_table','saves',
    'source_field','club_name',
    'raw_label',s.club_name,
    'resolution_method','legacy_save_primary'
  )
from public.saves s
where nullif(btrim(s.club_name),'') is not null
  and not exists (
    select 1 from public.save_clubs sc
    where sc.save_id=s.id and sc.tracking_role='primary' and sc.is_active
  )
  and not exists (
    select 1 from public.clubs c
    where c.save_id=s.id
      and c.normalized_name=public.datatracker_normalize_longitudinal_name(s.club_name)
  );

insert into public.save_clubs(
  save_id, owner_id, club_id, tracking_role, is_active, display_order, settings
)
select
  s.id,
  s.owner_id,
  c.id,
  'primary',
  true,
  0,
  jsonb_build_object('backfill_version','phase0b-v1','source','saves.club_name')
from public.saves s
join lateral (
  select c1.id
  from public.clubs c1
  where c1.save_id=s.id
    and c1.owner_id=s.owner_id
    and c1.normalized_name=public.datatracker_normalize_longitudinal_name(s.club_name)
  order by
    case when c1.source_kind='legacy' and c1.provenance->>'resolution_method'='legacy_save_primary' then 0 else 1 end,
    c1.created_at,
    c1.id
  limit 1
) c on true
where nullif(btrim(s.club_name),'') is not null
  and not exists (
    select 1 from public.save_clubs sc
    where sc.save_id=s.id and sc.tracking_role='primary' and sc.is_active
  )
on conflict (save_id, club_id) do update
set tracking_role='primary', is_active=true, display_order=0, updated_at=now();

-- Safely observed FM clubs. A Club is created only when the offline reader
-- explicitly resolved the current contract team name and Team ID. Reserve/youth
-- roster teams are not promoted to Club merely because they appear in roster_group.
with safe_fm_clubs as (
  select distinct on (ps.save_id, ps.normalized_data->>'contract_current_team_id')
    ps.save_id,
    p.owner_id,
    ps.import_id,
    ps.id as snapshot_id,
    nullif(ps.normalized_data->>'contract_current_team_id','') as fm_club_id,
    nullif(ps.normalized_data->>'contract_current_team_name','') as club_name
  from public.player_snapshots ps
  join public.players p on p.id=ps.player_id and p.save_id=ps.save_id
  where ps.normalized_data->>'source'='fm26-save-offline'
    and nullif(ps.normalized_data->>'contract_current_team_id','') is not null
    and nullif(ps.normalized_data->>'contract_current_team_name','') is not null
    and nullif(btrim(ps.club),'') is not null
    and ps.club=ps.normalized_data->>'contract_current_team_name'
    and ps.normalized_data->>'contract_team_semantics_status'='superseded_by_resolved_current_contract'
  order by ps.save_id, ps.normalized_data->>'contract_current_team_id', ps.snapshot_date, ps.id
)
update public.clubs c
set
  fm_club_id=s.fm_club_id,
  updated_at=now(),
  provenance=c.provenance || jsonb_build_object(
    'fm_identity_backfill',jsonb_build_object(
      'backfill_version','phase0b-v1',
      'source_snapshot_id',s.snapshot_id,
      'source_import_id',s.import_id,
      'resolution_method','confirmed_fm_current_contract_team'
    )
  )
from safe_fm_clubs s
where c.save_id=s.save_id
  and c.owner_id=s.owner_id
  and c.fm_club_id is null
  and c.normalized_name=public.datatracker_normalize_longitudinal_name(s.club_name)
  and not exists (
    select 1 from public.clubs occupied
    where occupied.save_id=s.save_id and occupied.fm_club_id=s.fm_club_id
  );

with safe_fm_clubs as (
  select distinct on (ps.save_id, ps.normalized_data->>'contract_current_team_id')
    ps.save_id,
    p.owner_id,
    ps.import_id,
    ps.id as snapshot_id,
    nullif(ps.normalized_data->>'contract_current_team_id','') as fm_club_id,
    nullif(ps.normalized_data->>'contract_current_team_name','') as club_name
  from public.player_snapshots ps
  join public.players p on p.id=ps.player_id and p.save_id=ps.save_id
  where ps.normalized_data->>'source'='fm26-save-offline'
    and nullif(ps.normalized_data->>'contract_current_team_id','') is not null
    and nullif(ps.normalized_data->>'contract_current_team_name','') is not null
    and nullif(btrim(ps.club),'') is not null
    and ps.club=ps.normalized_data->>'contract_current_team_name'
    and ps.normalized_data->>'contract_team_semantics_status'='superseded_by_resolved_current_contract'
  order by ps.save_id, ps.normalized_data->>'contract_current_team_id', ps.snapshot_date, ps.id
)
insert into public.clubs(
  save_id, owner_id, fm_club_id, name, normalized_name, source_kind,
  source_import_id, provenance
)
select
  s.save_id,
  s.owner_id,
  s.fm_club_id,
  s.club_name,
  public.datatracker_normalize_longitudinal_name(s.club_name),
  'legacy',
  s.import_id,
  jsonb_build_object(
    'backfill_version','phase0b-v1',
    'original_source_kind','fm',
    'source_snapshot_id',s.snapshot_id,
    'source_import_id',s.import_id,
    'source_field','normalized_data.contract_current_team_name',
    'resolution_method','confirmed_fm_current_contract_team'
  )
from safe_fm_clubs s
where not exists (
  select 1 from public.clubs c
  where c.save_id=s.save_id and c.fm_club_id=s.fm_club_id
)
and not exists (
  select 1 from public.clubs c
  where c.save_id=s.save_id
    and c.fm_club_id is null
    and c.normalized_name=public.datatracker_normalize_longitudinal_name(s.club_name)
);

-- B. Exact legacy season labels become stable Season entities. Dates remain null.
with labels as (
  select s.id as save_id, s.owner_id, s.current_season as label, 'saves.current_season' as origin
  from public.saves s
  where nullif(btrim(s.current_season),'') is not null
  union
  select
    st.save_id,
    s.owner_id,
    coalesce(nullif(st.season,''), nullif(st.normalized_stats->>'season','')) as label,
    'player_stats.season|normalized_stats.season' as origin
  from public.player_stats st
  join public.saves s on s.id=st.save_id
  where nullif(btrim(coalesce(nullif(st.season,''), nullif(st.normalized_stats->>'season',''))),'') is not null
  union
  select d.save_id, d.owner_id, d.season as label, 'decisions.season' as origin
  from public.decisions d
  where nullif(btrim(d.season),'') is not null
),
distinct_labels as (
  select save_id, owner_id, label, min(origin) as origin
  from labels
  group by save_id, owner_id, label
)
insert into public.seasons(
  save_id, owner_id, season_key, label, source_kind, provenance
)
select
  l.save_id,
  l.owner_id,
  'label:' || md5(l.label),
  l.label,
  'legacy',
  jsonb_build_object(
    'backfill_version','phase0b-v1',
    'source_field',l.origin,
    'raw_label',l.label,
    'resolution_method','exact_legacy_label',
    'dates_status','unknown'
  )
from distinct_labels l
on conflict (save_id, season_key) do nothing;

-- C. Every historical player snapshot becomes one observed membership checkpoint.
-- current_club resolves either from confirmed FM contract evidence or from an
-- exact normalized match to the save's tracked primary club. owner_club is only
-- asserted for explicit FM non-loan current-contract evidence.
with snapshot_context as (
  select
    ps.id as snapshot_id,
    ps.player_id,
    ps.save_id,
    p.owner_id,
    ps.import_id,
    ps.snapshot_date,
    ps.club,
    ps.squad,
    ps.normalized_data,
    case
      when jsonb_typeof(ps.normalized_data->'roster_group')='object'
       and ps.normalized_data->'roster_group'->>'primary'='true'
      then 'first_team'
      else 'unknown'
    end as normalized_team_level,
    case
      when ps.normalized_data->>'source'='fm26-save-offline'
       and nullif(ps.normalized_data->>'contract_current_team_id','') is not null
       and nullif(ps.normalized_data->>'contract_current_team_name','') is not null
       and ps.club=ps.normalized_data->>'contract_current_team_name'
       and ps.normalized_data->>'contract_team_semantics_status'='superseded_by_resolved_current_contract'
      then ps.normalized_data->>'contract_current_team_id'
      else null
    end as confirmed_fm_club_id
  from public.player_snapshots ps
  join public.players p on p.id=ps.player_id and p.save_id=ps.save_id
),
resolved as (
  select
    scx.*,
    case
      when fmclub.id is not null
       and scx.normalized_data->>'loan_status'='none'
      then fmclub.id
      when scx.normalized_data->>'source'<>'fm26-save-offline'
       and nullif(btrim(scx.club),'') is not null
       and primaryclub.normalized_name=public.datatracker_normalize_longitudinal_name(scx.club)
      then primaryclub.id
      else null
    end as current_club_id,
    case
      when fmclub.id is not null then fmclub.id
      else null
    end as owner_club_id,
    case
      when scx.normalized_data->>'source'='fm26-save-offline'
       and scx.normalized_data->>'loan_status'='current'
      then true
      when scx.normalized_data->>'source'='fm26-save-offline'
       and scx.normalized_data->>'loan_status'='none'
      then false
      else null
    end as is_loan,
    case
      when fmclub.id is not null
       and scx.normalized_data->>'loan_status'='none'
      then 'confirmed_fm_current_contract_team'
      when scx.normalized_data->>'source'='fm26-save-offline'
      then 'unresolved_current_location'
      when nullif(btrim(scx.club),'') is not null
       and primaryclub.normalized_name=public.datatracker_normalize_longitudinal_name(scx.club)
      then 'normalized_primary_club_match'
      else 'unresolved'
    end as club_resolution_method
  from snapshot_context scx
  left join public.clubs fmclub
    on fmclub.save_id=scx.save_id and fmclub.fm_club_id=scx.confirmed_fm_club_id
  left join public.save_clubs primary_sc
    on primary_sc.save_id=scx.save_id and primary_sc.tracking_role='primary' and primary_sc.is_active
  left join public.clubs primaryclub
    on primaryclub.id=primary_sc.club_id and primaryclub.save_id=scx.save_id
)
insert into public.player_memberships(
  save_id, owner_id, player_id, observed_date, current_club_id, owner_club_id,
  team_level, squad_name, is_loan, source_snapshot_id, source_import_id,
  source_kind, provenance
)
select
  r.save_id,
  r.owner_id,
  r.player_id,
  r.snapshot_date,
  r.current_club_id,
  r.owner_club_id,
  r.normalized_team_level,
  r.squad,
  r.is_loan,
  r.snapshot_id,
  r.import_id,
  'legacy',
  jsonb_build_object(
    'backfill_version','phase0b-v1',
    'original_source_kind',case when r.normalized_data->>'source'='fm26-save-offline' then 'fm' else 'legacy' end,
    'source_snapshot_id',r.snapshot_id,
    'source_import_id',r.import_id,
    'raw_club_label',r.club,
    'raw_squad_label',r.squad,
    'club_resolution_method',r.club_resolution_method,
    'team_level_resolution_method',case when r.normalized_team_level='first_team' then 'roster_group.primary=true' else 'unresolved' end
  )
from resolved r
on conflict (player_id, observed_date, source_snapshot_id)
  where source_snapshot_id is not null
do nothing;

-- D. Historical intake imports are promoted only if every imported snapshot has
-- resolved to exactly one current Club. Otherwise the original import remains
-- untouched and class creation stays pending.
with safe_intakes as (
  select
    i.id as import_id,
    i.save_id,
    i.owner_id,
    i.snapshot_date,
    min(pm.current_club_id::text)::uuid as club_id,
    count(*) as snapshot_count,
    count(*) filter (where pm.current_club_id is null) as unresolved_count,
    count(distinct pm.current_club_id) filter (where pm.current_club_id is not null) as club_count
  from public.imports i
  join public.player_snapshots ps
    on ps.import_id=i.id and ps.save_id=i.save_id
  join public.player_memberships pm
    on pm.source_snapshot_id=ps.id and pm.player_id=ps.player_id and pm.save_id=ps.save_id
  where i.file_type='intake' and i.status='imported'
  group by i.id, i.save_id, i.owner_id, i.snapshot_date
  having count(*) > 0
     and count(*) filter (where pm.current_club_id is null)=0
     and count(distinct pm.current_club_id)=1
)
insert into public.intake_classes(
  save_id, owner_id, club_id, class_key, label, intake_date,
  source_import_id, source_kind, provenance
)
select
  si.save_id,
  si.owner_id,
  si.club_id,
  'intake:' || si.snapshot_date::text,
  'Intake ' || si.snapshot_date::text,
  si.snapshot_date,
  si.import_id,
  'legacy',
  jsonb_build_object(
    'backfill_version','phase0b-v1',
    'source_import_id',si.import_id,
    'resolution_method','single_resolved_club_intake_import'
  )
from safe_intakes si
on conflict (save_id, club_id, class_key) do nothing;

insert into public.intake_class_members(
  intake_class_id, save_id, owner_id, player_id, baseline_snapshot_id,
  membership_status, source_import_id, source_kind, provenance
)
select
  ic.id,
  ic.save_id,
  ic.owner_id,
  ps.player_id,
  ps.id,
  'confirmed',
  i.id,
  'legacy',
  jsonb_build_object(
    'backfill_version','phase0b-v1',
    'source_import_id',i.id,
    'source_snapshot_id',ps.id,
    'resolution_method','direct_intake_import_membership'
  )
from public.imports i
join public.intake_classes ic
  on ic.source_import_id=i.id and ic.save_id=i.save_id
join public.player_snapshots ps
  on ps.import_id=i.id and ps.save_id=i.save_id
where i.file_type='intake' and i.status='imported'
on conflict (intake_class_id, player_id) do nothing;

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
    and not exists (
      select 1 from public.saves s
      where nullif(btrim(s.club_name),'') is not null
        and not exists (
          select 1 from public.save_clubs sc
          where sc.save_id=s.id and sc.tracking_role='primary' and sc.is_active
        )
    );
  v_longitudinal_save_structure boolean :=
    to_regprocedure('public.create_save_with_structure(text,text,text)') is not null;
  v_longitudinal_imports boolean :=
    to_regprocedure('public.sync_longitudinal_import()') is not null
    and to_regprocedure('public.cleanup_longitudinal_import()') is not null
    and exists(
      select 1 from pg_trigger
      where tgrelid='public.imports'::regclass
        and tgname='sync_longitudinal_import_on_status'
        and not tgisinternal
    )
    and exists(
      select 1 from pg_trigger
      where tgrelid='public.imports'::regclass
        and tgname='cleanup_longitudinal_import_before_delete'
        and not tgisinternal
    );
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

  return jsonb_build_object(
    'schema_version','202608290002',
    'app_version','0.27.0',
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
      'longitudinal_imports',v_longitudinal_imports
    )
  );
end
$$;

notify pgrst,'reload schema';

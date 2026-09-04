-- FM DataTracker — E-MC-01B Phase0E nested provenance reconciliation
-- Data-only follow-up: catches legacy Clubs where a generic top-level resolution_method
-- masked the authoritative Phase0E fm_identity.resolution_method signal.

with legacy_clubs as (
  select
    c.id,
    c.save_id,
    c.owner_id,
    c.fm_club_id,
    c.name,
    c.provenance,
    c.provenance->'fm_identity'->>'resolution_method' as legacy_method,
    nullif(c.provenance->'fm_identity'->>'source_import_id','') as legacy_import_text,
    nullif(c.provenance->'fm_identity'->>'source_snapshot_id','') as legacy_snapshot_text
  from public.clubs c
  where c.fm_club_id ~ '^[0-9]+$'
    and c.fm_club_id::bigint > 0
    and c.fm_club_id::bigint < 100000
    and c.provenance->'fm_identity'->>'resolution_method' in (
      'confirmed_fm_current_contract_team',
      'confirmed_current_loan_from_team',
      'confirmed_current_loan_to_team'
    )
    and coalesce(c.provenance->>'resolution_method','') not in (
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
    'resolution_method','phase0e_nested_raw_team_id_reclassified_as_legacy_candidate',
    'legacy_method',rs.legacy_method,
    'legacy_fm_club_id',rs.fm_club_id,
    'original_club_provenance',rs.provenance,
    'public_club_uid_status','unknown'
  )
from resolved_sources rs
on conflict(save_id,structural_team_id,evidence_key) do nothing;

with legacy_clubs as (
  select
    c.id,
    c.save_id,
    c.owner_id,
    c.fm_club_id,
    c.provenance,
    c.provenance->'fm_identity'->>'resolution_method' as legacy_method
  from public.clubs c
  where c.fm_club_id ~ '^[0-9]+$'
    and c.fm_club_id::bigint > 0
    and c.fm_club_id::bigint < 100000
    and c.provenance->'fm_identity'->>'resolution_method' in (
      'confirmed_fm_current_contract_team',
      'confirmed_current_loan_from_team',
      'confirmed_current_loan_to_team'
    )
    and coalesce(c.provenance->>'resolution_method','') not in (
      'confirmed_fm_current_contract_team',
      'confirmed_current_loan_from_team',
      'confirmed_current_loan_to_team'
    )
), updated as (
  update public.clubs c
  set
    provenance=c.provenance||jsonb_build_object(
      'emc01b_legacy_reconciliation',jsonb_build_object(
        'status','legacy_phase0e_structural_team_candidate',
        'original_fm_club_id',lc.fm_club_id,
        'legacy_resolution_method',lc.legacy_method,
        'reconciled_by','e-mc-01b-v1-nested-fix',
        'public_club_uid_status','unknown'
      )
    ),
    fm_club_id=null,
    updated_at=now()
  from legacy_clubs lc
  where c.id=lc.id
  returning c.save_id,c.owner_id,lc.fm_club_id::integer as structural_team_id
)
select public.datatracker_rebuild_structural_team_link(save_id,owner_id,structural_team_id)
from updated;

notify pgrst,'reload schema';

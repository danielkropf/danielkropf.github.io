-- FM DataTracker — stabilization 4.2 / E-MC-01B FK coverage
-- Adds covering indexes for the composite foreign keys introduced by E-MC-01B.
-- No historical rows or factual semantics are rewritten.

create index if not exists club_structural_team_links_save_owner_idx
  on public.club_structural_team_links(save_id, owner_id);
create index if not exists club_structural_team_links_club_save_owner_idx
  on public.club_structural_team_links(club_id, save_id, owner_id);
create index if not exists club_structural_team_links_import_save_idx
  on public.club_structural_team_links(source_import_id, save_id);

create index if not exists club_structural_team_link_evidence_save_owner_idx
  on public.club_structural_team_link_evidence(save_id, owner_id);
create index if not exists club_structural_team_link_evidence_club_save_owner_idx
  on public.club_structural_team_link_evidence(club_id, save_id, owner_id);
create index if not exists club_structural_team_link_evidence_import_save_idx
  on public.club_structural_team_link_evidence(source_import_id, save_id);
create index if not exists club_structural_team_link_evidence_player_save_owner_idx
  on public.club_structural_team_link_evidence(source_player_id, save_id, owner_id);
create index if not exists club_structural_team_link_evidence_snapshot_player_save_idx
  on public.club_structural_team_link_evidence(source_snapshot_id, source_player_id, save_id);

-- The schema capability marker is unchanged because this migration is performance-only.
-- Keep the app marker synchronized with the candidate that carries this migration without
-- copying the full schema-info function and risking drift from the canonical definition.
do $$
declare
  v_current text;
  v_definition text;
  v_updated text;
begin
  v_current := public.datatracker_schema_info()->>'app_version';
  if v_current = '0.29.5' then
    return;
  end if;
  if v_current <> '0.29.4' then
    raise exception 'Unexpected datatracker app marker %, expected 0.29.4 before stabilization 4.2', v_current;
  end if;

  select pg_get_functiondef('public.datatracker_schema_info()'::regprocedure)
    into v_definition;
  v_updated := replace(
    v_definition,
    '''app_version'',''0.29.4''',
    '''app_version'',''0.29.5'''
  );
  if v_updated = v_definition then
    raise exception 'Could not locate the canonical 0.29.4 app marker in datatracker_schema_info()';
  end if;
  execute v_updated;
end
$$;

notify pgrst,'reload schema';

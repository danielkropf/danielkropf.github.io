-- v0.33.0: controlled, source-identical reader upgrade and literal squad names.
-- Does not replay imports or modify snapshots. Previous membership row is kept
-- in provenance. Same-reader divergent payloads remain rejected.
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
  v_reader_upgrade boolean;
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

    v_reader_upgrade := false;
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
      if v_row->>'reader_version'='fm26-membership-reader/0.33.0'
         and coalesce(v_existing.provenance->>'membership_reader_version','legacy') in ('legacy','fm26-membership-reader/e-mc-01-v1') then
        v_reader_upgrade := true;
      else
        raise exception 'E-MC-01B same-source membership facts conflict for FM ID %',v_fm_id;
      end if;
    end if;

    if v_has_existing and not v_reader_upgrade
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
    v_squad_name := case when v_row#>>'{structural_squad,status}'='confirmed'
      then nullif(btrim(v_row#>>'{structural_squad,value,label_raw}'),'') else null end;
    -- The structural roster can belong to the loan's owning club, not the
    -- currently receiving club. Keep that evidence raw, never relabel the latter.
    if v_row#>>'{organization_identity,status}'='confirmed'
       and v_row#>>'{current_organization,status}'='confirmed'
       and v_row#>>'{organization_identity,value,organization_ref}'
           is distinct from v_row#>>'{current_organization,value,organization_ref}' then
      v_squad_name := null;
      v_team_level := 'unknown';
    end if;

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
    v_provenance := v_provenance || jsonb_build_object('membership_reader_version',coalesce(v_row->>'reader_version','legacy'));
    if v_reader_upgrade then
      v_provenance := v_provenance || jsonb_build_object('previous_reader_observation',to_jsonb(v_existing));
    end if;
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

revoke execute on function public.datatracker_sync_fm_membership_rows(uuid,uuid,date,jsonb) from public,anon;
grant execute on function public.datatracker_sync_fm_membership_rows(uuid,uuid,date,jsonb) to authenticated,service_role;
notify pgrst,'reload schema';

-- Publish the import-specific capability only together with the updated sync.
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
  v_diag_retention boolean := false;
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
  -- authenticated legitimately has no USAGE on the cron schema. The diagnostic
  -- retention capability is optional, so lack of visibility must fail closed
  -- instead of making the entire compatibility RPC return 403.
  begin
    v_diag_retention :=
      exists(select 1 from pg_extension where extname='pg_cron')
      and exists(select 1 from pg_extension where extname='pg_net')
      and exists(select 1 from cron.job where jobname='fm-reader-samples-retention');
  exception when insufficient_privilege then
    v_diag_retention := false;
  end;

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
    'schema_version','202609091420',
    'app_version','0.33.0',
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
      'factual_membership_emc01b',v_emc01b,
      'reader_033_membership_refresh',true
    )
  );
end
$$;

notify pgrst,'reload schema';

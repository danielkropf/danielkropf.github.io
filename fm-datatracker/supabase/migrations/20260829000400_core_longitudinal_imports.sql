-- FM DataTracker — Phase 0E
-- Persist longitudinal facts automatically when an import becomes imported.
-- The existing import_fm_export RPC remains the transactional ingestion contract.

create or replace function public.sync_longitudinal_import()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_snapshot record;
  v_source_kind text;
  v_contract_team_id text;
  v_contract_team_name text;
  v_loan_status text;
  v_loan_from_id text;
  v_loan_from_name text;
  v_loan_to_id text;
  v_loan_to_name text;
  v_contract_club_id uuid;
  v_loan_from_club_id uuid;
  v_loan_to_club_id uuid;
  v_current_club_id uuid;
  v_owner_club_id uuid;
  v_candidate_id uuid;
  v_candidate_count integer;
  v_team_level text;
  v_season_label text;
  v_intake_club_id uuid;
  v_intake_class_id uuid;
  v_unresolved integer;
  v_club_count integer;
  v_membership_count integer;
  v_all_fm boolean;
begin
  if new.status <> 'imported' then return new; end if;
  if tg_op='UPDATE' then
    if old.status='imported' then return new; end if;
  end if;

  -- Explicit season labels only. Never infer a season from a date.
  for v_season_label in
    select distinct label
    from (
      select coalesce(
        nullif(st.season,''),
        nullif(st.normalized_stats->>'season','')
      ) as label
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
    select ps.*, p.owner_id as player_owner_id
    from public.player_snapshots ps
    join public.players p on p.id=ps.player_id and p.save_id=ps.save_id
    where ps.import_id=new.id and ps.save_id=new.save_id
    order by ps.id
  loop
    v_source_kind := case when v_snapshot.normalized_data->>'source'='fm26-save-offline' then 'fm' else 'csv' end;
    v_contract_team_id := nullif(v_snapshot.normalized_data->>'contract_current_team_id','');
    v_contract_team_name := nullif(v_snapshot.normalized_data->>'contract_current_team_name','');
    v_loan_status := nullif(v_snapshot.normalized_data->>'loan_status','');
    v_loan_from_id := nullif(v_snapshot.normalized_data->>'loan_from_team_id','');
    v_loan_from_name := nullif(v_snapshot.normalized_data->>'loan_from_team_name','');
    v_loan_to_id := nullif(v_snapshot.normalized_data->>'loan_to_team_id','');
    v_loan_to_name := nullif(v_snapshot.normalized_data->>'loan_to_team_name','');

    v_contract_club_id := null;
    v_loan_from_club_id := null;
    v_loan_to_club_id := null;
    v_current_club_id := null;
    v_owner_club_id := null;

    -- Confirmed current contract team = owner organization evidence.
    if v_source_kind='fm'
       and v_contract_team_id is not null
       and v_contract_team_name is not null
       and v_snapshot.normalized_data->>'contract_team_semantics_status'='superseded_by_resolved_current_contract'
    then
      select c.id into v_contract_club_id
      from public.clubs c
      where c.save_id=new.save_id and c.fm_club_id=v_contract_team_id
      limit 1;

      if v_contract_club_id is null then
        select count(*), min(c.id::text)::uuid
          into v_candidate_count, v_candidate_id
        from public.clubs c
        where c.save_id=new.save_id
          and c.fm_club_id is null
          and c.normalized_name=public.datatracker_normalize_longitudinal_name(v_contract_team_name);

        if v_candidate_count=1 then
          update public.clubs
          set fm_club_id=v_contract_team_id,
              updated_at=now(),
              provenance=provenance||jsonb_build_object(
                'fm_identity',jsonb_build_object(
                  'source_import_id',new.id,
                  'source_snapshot_id',v_snapshot.id,
                  'resolution_method','confirmed_fm_current_contract_team'
                )
              )
          where id=v_candidate_id
          returning id into v_contract_club_id;
        else
          insert into public.clubs(
            save_id,owner_id,fm_club_id,name,normalized_name,source_kind,
            source_import_id,provenance
          )
          values(
            new.save_id,new.owner_id,v_contract_team_id,v_contract_team_name,
            public.datatracker_normalize_longitudinal_name(v_contract_team_name),
            'fm',new.id,
            jsonb_build_object(
              'source_import_id',new.id,
              'source_snapshot_id',v_snapshot.id,
              'source_field','normalized_data.contract_current_team_name',
              'resolution_method','confirmed_fm_current_contract_team'
            )
          )
          on conflict(save_id,fm_club_id) where fm_club_id is not null
          do update set updated_at=public.clubs.updated_at
          returning id into v_contract_club_id;
        end if;
      end if;
    end if;

    -- Confirmed current loan: the from-team is ownership and the to-team is
    -- current membership. Both require explicit resolved IDs and names.
    if v_source_kind='fm' and v_loan_status='current' then
      if v_loan_from_id is not null and v_loan_from_name is not null then
        if v_contract_team_id=v_loan_from_id and v_contract_club_id is not null then
          v_loan_from_club_id := v_contract_club_id;
        else
          select c.id into v_loan_from_club_id
          from public.clubs c
          where c.save_id=new.save_id and c.fm_club_id=v_loan_from_id
          limit 1;
          if v_loan_from_club_id is null then
            insert into public.clubs(
              save_id,owner_id,fm_club_id,name,normalized_name,source_kind,
              source_import_id,provenance
            )
            values(
              new.save_id,new.owner_id,v_loan_from_id,v_loan_from_name,
              public.datatracker_normalize_longitudinal_name(v_loan_from_name),
              'fm',new.id,
              jsonb_build_object(
                'source_import_id',new.id,
                'source_snapshot_id',v_snapshot.id,
                'source_field','normalized_data.loan_from_team_name',
                'resolution_method','confirmed_current_loan_from_team'
              )
            )
            on conflict(save_id,fm_club_id) where fm_club_id is not null
            do update set updated_at=public.clubs.updated_at
            returning id into v_loan_from_club_id;
          end if;
        end if;
      end if;

      if v_loan_to_id is not null and v_loan_to_name is not null then
        select c.id into v_loan_to_club_id
        from public.clubs c
        where c.save_id=new.save_id and c.fm_club_id=v_loan_to_id
        limit 1;
        if v_loan_to_club_id is null then
          insert into public.clubs(
            save_id,owner_id,fm_club_id,name,normalized_name,source_kind,
            source_import_id,provenance
          )
          values(
            new.save_id,new.owner_id,v_loan_to_id,v_loan_to_name,
            public.datatracker_normalize_longitudinal_name(v_loan_to_name),
            'fm',new.id,
            jsonb_build_object(
              'source_import_id',new.id,
              'source_snapshot_id',v_snapshot.id,
              'source_field','normalized_data.loan_to_team_name',
              'resolution_method','confirmed_current_loan_to_team'
            )
          )
          on conflict(save_id,fm_club_id) where fm_club_id is not null
          do update set updated_at=public.clubs.updated_at
          returning id into v_loan_to_club_id;
        end if;
      end if;

      v_owner_club_id := coalesce(v_loan_from_club_id,v_contract_club_id);
      v_current_club_id := v_loan_to_club_id;
    elsif v_source_kind='fm' and v_loan_status='none' then
      v_owner_club_id := v_contract_club_id;
      v_current_club_id := v_contract_club_id;
    elsif v_source_kind='fm' then
      -- Contract ownership can still be known while current location remains
      -- unresolved because loan semantics are unresolved.
      v_owner_club_id := v_contract_club_id;
      v_current_club_id := null;
    end if;

    -- Generic CSV/legacy club labels may resolve to an already tracked club,
    -- but they never create a new Club by name alone.
    if v_current_club_id is null
       and v_source_kind<>'fm'
       and nullif(btrim(v_snapshot.club),'') is not null
    then
      select c.id into v_current_club_id
      from public.save_clubs sc
      join public.clubs c
        on c.id=sc.club_id and c.save_id=sc.save_id and c.owner_id=sc.owner_id
      where sc.save_id=new.save_id
        and sc.is_active
        and c.normalized_name=public.datatracker_normalize_longitudinal_name(v_snapshot.club)
      order by case when sc.tracking_role='primary' then 0 else 1 end, sc.display_order, sc.id
      limit 1;
    end if;

    v_team_level := case
      when v_snapshot.team_level in ('first_team','reserve','academy','other')
        then v_snapshot.team_level
      when jsonb_typeof(v_snapshot.normalized_data->'roster_group')='object'
       and v_snapshot.normalized_data->'roster_group'->>'primary'='true'
        then 'first_team'
      else 'unknown'
    end;

    insert into public.player_memberships(
      save_id,owner_id,player_id,observed_date,current_club_id,owner_club_id,
      team_level,squad_name,is_loan,loan_from_club_id,loan_to_club_id,
      source_snapshot_id,source_import_id,source_kind,provenance
    )
    values(
      new.save_id,new.owner_id,v_snapshot.player_id,v_snapshot.snapshot_date,
      v_current_club_id,v_owner_club_id,v_team_level,v_snapshot.squad,
      case when v_loan_status='current' then true when v_loan_status='none' then false else null end,
      v_loan_from_club_id,v_loan_to_club_id,
      v_snapshot.id,new.id,v_source_kind,
      jsonb_build_object(
        'source_import_id',new.id,
        'source_snapshot_id',v_snapshot.id,
        'raw_club_label',v_snapshot.club,
        'raw_squad_label',v_snapshot.squad,
        'club_resolution_method',case
          when v_loan_status='current' and v_current_club_id is not null then 'confirmed_current_loan_to_team'
          when v_source_kind='fm' and v_loan_status='none' and v_current_club_id is not null then 'confirmed_fm_current_contract_team'
          when v_source_kind='fm' then 'unresolved_current_location'
          when v_current_club_id is not null then 'normalized_tracked_club_match'
          else 'unresolved'
        end,
        'owner_resolution_method',case
          when v_owner_club_id is not null then 'confirmed_fm_contract_or_loan_from_team'
          else 'unresolved'
        end,
        'team_level_resolution_method',case
          when v_team_level<>'unknown' then 'explicit_snapshot_or_primary_roster'
          else 'unresolved'
        end
      )
    )
    on conflict(player_id,observed_date,source_snapshot_id)
      where source_snapshot_id is not null
    do nothing;
  end loop;

  -- A direct intake import can become one immutable class only when every
  -- imported snapshot resolves to the same *tracked* current Club.
  select
    count(*),
    count(*) filter(where pm.current_club_id is null),
    count(distinct pm.current_club_id) filter(where pm.current_club_id is not null),
    min(pm.current_club_id::text)::uuid,
    coalesce(bool_and(pm.source_kind='fm'),false)
  into
    v_membership_count,v_unresolved,v_club_count,v_intake_club_id,v_all_fm
  from public.player_memberships pm
  where pm.source_import_id=new.id and pm.save_id=new.save_id;

  if new.file_type='intake'
     and v_membership_count>0
     and v_unresolved=0
     and v_club_count=1
     and exists(
       select 1 from public.save_clubs sc
       where sc.save_id=new.save_id
         and sc.club_id=v_intake_club_id
         and sc.is_active
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
      new.snapshot_date,new.id,
      case when v_all_fm then 'fm' else 'csv' end,
      jsonb_build_object(
        'source_import_id',new.id,
        'resolution_method','single_tracked_club_direct_intake'
      )
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
      'confirmed',new.id,pm.source_kind,
      jsonb_build_object(
        'source_import_id',new.id,
        'source_snapshot_id',pm.source_snapshot_id,
        'resolution_method','direct_intake_import_membership'
      )
    from public.player_memberships pm
    where pm.source_import_id=new.id
      and pm.save_id=new.save_id
      and pm.source_snapshot_id is not null
    on conflict(intake_class_id,player_id) do nothing;
  end if;

  update public.imports
  set parser_profile=case
        when parser_profile='integrity-v1' then 'integrity-v2-longitudinal'
        else parser_profile
      end,
      source_schema=coalesce(source_schema,'{}'::jsonb)||jsonb_build_object(
        'longitudinal_sync_version','phase0e-v1'
      )
  where id=new.id and save_id=new.save_id;

  return new;
end
$$;

revoke execute on function public.sync_longitudinal_import() from public, anon, authenticated;

drop trigger if exists sync_longitudinal_import_on_insert on public.imports;
create trigger sync_longitudinal_import_on_insert
after insert on public.imports
for each row
when (new.status='imported')
execute function public.sync_longitudinal_import();

drop trigger if exists sync_longitudinal_import_on_status on public.imports;
create trigger sync_longitudinal_import_on_status
after update of status on public.imports
for each row
when (new.status='imported')
execute function public.sync_longitudinal_import();

create or replace function public.cleanup_longitudinal_import()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  delete from public.event_decision_links edl
  using public.save_events se
  where se.id=edl.event_id
    and se.save_id=old.save_id
    and se.source_import_id=old.id;

  delete from public.save_events
  where save_id=old.save_id
    and source_import_id=old.id
    and source_kind<>'manual';

  delete from public.intake_class_members
  where save_id=old.save_id and source_import_id=old.id;

  delete from public.intake_classes ic
  where ic.save_id=old.save_id
    and ic.source_import_id=old.id
    and not exists(
      select 1 from public.intake_class_members m
      where m.intake_class_id=ic.id
    );

  delete from public.player_memberships
  where save_id=old.save_id and source_import_id=old.id;

  -- Remove import-created observed Clubs only when no surviving longitudinal
  -- fact or tracked-club declaration still depends on them.
  delete from public.clubs c
  where c.save_id=old.save_id
    and c.source_import_id=old.id
    and not exists(select 1 from public.save_clubs sc where sc.club_id=c.id)
    and not exists(
      select 1 from public.player_memberships pm
      where pm.current_club_id=c.id
         or pm.owner_club_id=c.id
         or pm.loan_from_club_id=c.id
         or pm.loan_to_club_id=c.id
    )
    and not exists(select 1 from public.intake_classes ic where ic.club_id=c.id)
    and not exists(select 1 from public.save_events se where se.club_id=c.id);

  return old;
end
$$;

revoke execute on function public.cleanup_longitudinal_import() from public, anon, authenticated;

drop trigger if exists cleanup_longitudinal_import_before_delete on public.imports;
create trigger cleanup_longitudinal_import_before_delete
before delete on public.imports
for each row execute function public.cleanup_longitudinal_import();

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
    'schema_version','202608290004',
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

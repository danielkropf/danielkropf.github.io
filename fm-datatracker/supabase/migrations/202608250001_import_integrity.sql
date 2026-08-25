-- Integrity consolidation for public FM DataTracker imports.
-- This supersedes the local Oracle-era RPC copy without changing historical migrations.

create index if not exists players_save_fm_player_id_idx
  on public.players(save_id, fm_player_id)
  where fm_player_id is not null;

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
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_owner uuid := auth.uid();
  v_import uuid;
  v_row jsonb;
  v_player uuid;
  v_snapshot uuid;
  v_attr jsonb;
  v_stats jsonb;
  v_new int := 0;
  v_updated int := 0;
  v_incoming_fm text;
  v_name text;
  v_dob date;
  v_candidate_count int;
  v_has_later_squad boolean := false;
  v_is_latest_squad boolean := false;
  v_should_mark_active boolean := false;
begin
  if v_owner is null then
    raise exception 'Usuário não autenticado';
  end if;
  if not exists(select 1 from saves where id=p_save_id and owner_id=v_owner) then
    raise exception 'Save não encontrado';
  end if;
  if p_snapshot_date is null then
    raise exception 'Data do snapshot é obrigatória';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'Importação sem jogadores';
  end if;
  if exists(select 1 from imports where save_id=p_save_id and file_hash=p_file_hash) then
    return jsonb_build_object('duplicate',true,'new_players',0,'updated_players',0);
  end if;

  select exists(
    select 1
    from imports
    where save_id=p_save_id
      and file_type='squad'
      and status='imported'
      and snapshot_date > p_snapshot_date
  ) into v_has_later_squad;

  v_is_latest_squad := p_file_type='squad' and not v_has_later_squad;
  v_should_mark_active := p_file_type in ('squad','intake') and not v_has_later_squad;

  insert into imports(
    save_id,owner_id,original_filename,file_type,snapshot_date,file_hash,row_count,
    delimiter,parser_profile,warnings,status
  )
  values(
    p_save_id,v_owner,p_filename,p_file_type,p_snapshot_date,p_file_hash,jsonb_array_length(p_rows),
    p_delimiter,'integrity-v1',coalesce(p_warnings,'[]'::jsonb),'parsed'
  )
  returning id into v_import;

  -- A full roster snapshot defines current membership only when it is not older
  -- than an already imported full roster.
  if v_is_latest_squad then
    update players
      set is_active=false, updated_at=now()
      where save_id=p_save_id and is_active=true;
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_player := null;
    v_incoming_fm := nullif(v_row->>'fm_player_id','');
    v_name := nullif(v_row->>'normalized_name','');
    v_dob := nullif(v_row->>'date_of_birth','')::date;

    if v_name is null then
      raise exception 'Linha sem nome normalizado';
    end if;

    if v_incoming_fm is not null then
      select count(*) into v_candidate_count
      from players
      where save_id=p_save_id
        and (fm_player_id=v_incoming_fm or identity_key='fm:'||v_incoming_fm);

      if v_candidate_count > 1 then
        raise exception 'Identidade FM duplicada no Banco Mestre: %', v_incoming_fm;
      elsif v_candidate_count = 1 then
        select id into v_player
        from players
        where save_id=p_save_id
          and (fm_player_id=v_incoming_fm or identity_key='fm:'||v_incoming_fm)
        limit 1;
      elsif v_dob is not null then
        -- Safe promotion of an older bio-only record to the stable FM id.
        select count(*) into v_candidate_count
        from players
        where save_id=p_save_id
          and fm_player_id is null
          and normalized_name=v_name
          and date_of_birth=v_dob;

        if v_candidate_count > 1 then
          raise exception 'Identidade ambígua ao promover % para FM ID %', v_name, v_incoming_fm;
        elsif v_candidate_count = 1 then
          select id into v_player
          from players
          where save_id=p_save_id
            and fm_player_id is null
            and normalized_name=v_name
            and date_of_birth=v_dob
          limit 1;
        end if;
      end if;
    else
      if v_dob is not null then
        select count(*) into v_candidate_count
        from players
        where save_id=p_save_id
          and normalized_name=v_name
          and date_of_birth=v_dob;

        if v_candidate_count > 1 then
          raise exception 'Identidade ambígua por nome+nascimento: % / %', v_name, v_dob;
        elsif v_candidate_count = 1 then
          select id into v_player
          from players
          where save_id=p_save_id
            and normalized_name=v_name
            and date_of_birth=v_dob
          limit 1;
        end if;
      else
        select count(*) into v_candidate_count
        from players
        where save_id=p_save_id and normalized_name=v_name;

        if v_candidate_count > 1 then
          raise exception 'Identidade ambígua por nome: %', v_name;
        elsif v_candidate_count = 1 then
          select id into v_player
          from players
          where save_id=p_save_id and normalized_name=v_name
          limit 1;
        end if;
      end if;
    end if;

    if v_player is null then
      insert into players(
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
      v_new := v_new + 1;
    else
      update players
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
      v_updated := v_updated + 1;
    end if;

    if p_file_type in ('squad','intake') then
      insert into player_snapshots(
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
        nullif(v_row->>'contract_expiry','')::date,
        coalesce(v_row->'raw_data','{}'::jsonb),
        coalesce(v_row->'normalized_data','{}'::jsonb)
      )
      returning id into v_snapshot;

      for v_attr in
        select * from jsonb_array_elements(coalesce(v_row->'attributes','[]'::jsonb))
      loop
        insert into player_attributes(
          player_snapshot_id,attribute_key,attribute_label,value,source_column,category
        )
        values(
          v_snapshot,v_attr->>'attribute_key',v_attr->>'attribute_label',
          (v_attr->>'value')::numeric,v_attr->>'source_column',v_attr->>'category'
        );
      end loop;

      if nullif(v_row->>'contract_expiry','') is not null then
        insert into contracts(player_id,owner_id,snapshot_date,expiry_date)
        values(v_player,v_owner,p_snapshot_date,(v_row->>'contract_expiry')::date)
        on conflict(player_id,snapshot_date)
        do update set expiry_date=excluded.expiry_date;
      end if;

      -- The offline reader already resolves current-team stat aggregates for
      -- many players. Preserve that result in the same historical stats table
      -- instead of hiding it only inside snapshot JSON.
      v_stats := coalesce(v_row->'statistics',v_row->'normalized_data'->'statistics');
      if v_stats is not null and jsonb_typeof(v_stats)='object' and v_stats <> '{}'::jsonb then
        insert into player_stats(
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
      insert into player_stats(
        player_id,save_id,import_id,snapshot_date,minutes,appearances,starts,sub_appearances,
        raw_stats,normalized_stats
      )
      values(
        v_player,p_save_id,v_import,p_snapshot_date,
        nullif(v_row->>'minutes','')::numeric,
        nullif(v_row->>'appearances','')::numeric,
        nullif(v_row->>'starts','')::numeric,
        nullif(v_row->>'sub_appearances','')::numeric,
        coalesce(v_row->'raw_data','{}'::jsonb),
        coalesce(v_row->'normalized_data','{}'::jsonb)
      );
    end if;
  end loop;

  update imports set status='imported' where id=v_import;

  return jsonb_build_object(
    'duplicate',false,
    'import_id',v_import,
    'new_players',v_new,
    'updated_players',v_updated,
    'rows',jsonb_array_length(p_rows)
  );
end
$$;


create or replace function public.patch_scoring_model_config(
  p_save_id uuid,
  p_name text,
  p_version text,
  p_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_owner uuid := auth.uid();
  v_model uuid;
  v_config jsonb;
begin
  if v_owner is null then
    raise exception 'Usuário não autenticado';
  end if;
  if not exists(select 1 from saves where id=p_save_id and owner_id=v_owner) then
    raise exception 'Save não encontrado';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Patch de configuração inválido';
  end if;

  -- Serialize all writers for the same save/model. This prevents Planning,
  -- Tactics and Scoring tabs from overwriting one another with stale copies.
  perform pg_advisory_xact_lock(hashtextextended(p_save_id::text||':'||coalesce(p_name,''),0));

  select id,config into v_model,v_config
  from scoring_models
  where owner_id=v_owner and save_id=p_save_id and name=p_name and is_active=true
  order by created_at,id
  limit 1
  for update;

  if v_model is null then
    insert into scoring_models(owner_id,save_id,name,version,config,is_active)
    values(v_owner,p_save_id,p_name,p_version,p_patch,true)
    returning id,config into v_model,v_config;
  else
    update scoring_models
    set config=coalesce(config,'{}'::jsonb)||p_patch,
        version=p_version,
        is_active=true
    where id=v_model
    returning config into v_config;
  end if;

  return jsonb_build_object('id',v_model,'config',v_config);
end
$$;


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

  -- Contracts are not import-owned in the original schema. Remove orphaned
  -- contract snapshots only when no surviving player snapshot supports them.
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

  -- Imports can be removed from history. Do not leave empty player shells.
  delete from players p
  where p.save_id=p_save_id
    and not exists(select 1 from player_snapshots ps where ps.player_id=p.id)
    and not exists(select 1 from player_stats st where st.player_id=p.id);

  -- Recompute historical first/last seen after cascades.
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
    -- Without a full squad snapshot, keep players from the latest available
    -- squad/intake date active instead of claiming every historical row is current.
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

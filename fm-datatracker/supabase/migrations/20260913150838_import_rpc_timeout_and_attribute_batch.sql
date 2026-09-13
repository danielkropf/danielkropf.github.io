-- Restore the timeout on the actual PostgREST entry point. Its replacement
-- in E-MC-01B lost the old 60s setting and inherited authenticated's 8s.
-- Keep headroom below the REST gateway's 60s limit; no global/role change.
-- Batch each player's attributes without changing identity, RLS or transaction boundaries.
CREATE OR REPLACE FUNCTION public.import_fm_export(p_save_id uuid, p_filename text, p_file_type text, p_snapshot_date date, p_file_hash text, p_delimiter text, p_warnings jsonb, p_rows jsonb, p_membership_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET statement_timeout TO '55s'
AS $function$
declare
  v_owner uuid := auth.uid();
  v_import uuid;
  v_existing_import public.imports%rowtype;
  v_row jsonb;
  v_player uuid;
  v_snapshot uuid;
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

      insert into public.player_attributes(
        player_snapshot_id,attribute_key,attribute_label,value,source_column,category
      )
      select v_snapshot,attrs.value->>'attribute_key',attrs.value->>'attribute_label',
        (attrs.value->>'value')::numeric,attrs.value->>'source_column',attrs.value->>'category'
      from jsonb_array_elements(coalesce(v_row->'attributes','[]'::jsonb)) as attrs(value);

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
$function$;

alter function public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb)
  set statement_timeout = '55s';
notify pgrst, 'reload schema';

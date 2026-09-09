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
  v_provenance_candidate_count integer := 0;
  v_provenance_candidate_club uuid;
  v_recovered_from_provenance boolean := false;
  v_club uuid;
  v_team integer;
  v_existing public.club_structural_team_link_evidence%rowtype;
  v_evidence_key text := 'snapshot:'||p_snapshot_id::text;
begin
  if v_auth is not null and v_auth <> p_owner_id then raise exception 'E-MC-01B organization owner mismatch'; end if;
  if not exists(select 1 from public.saves s where s.id=p_save_id and s.owner_id=p_owner_id) then raise exception 'E-MC-01B save não encontrado'; end if;
  if jsonb_typeof(p_organization)<>'object' then return jsonb_build_object('status','unsupported','reason_code','invalid_organization_shape','club_id',null); end if;
  v_org_ref := nullif(btrim(p_organization->>'organization_ref'),'');
  if v_org_ref is null or jsonb_typeof(p_organization->'organization_team_ids')<>'array' then return jsonb_build_object('status','unsupported','reason_code','invalid_organization_identity','club_id',null); end if;
  v_raw_team_count := jsonb_array_length(p_organization->'organization_team_ids');
  select count(*),array_agg(distinct value::integer order by value::integer) into v_valid_team_count,v_team_ids from jsonb_array_elements_text(p_organization->'organization_team_ids') team(value) where value ~ '^[0-9]+$' and value::bigint>0 and value::bigint<100000;
  if v_raw_team_count=0 or v_valid_team_count<>v_raw_team_count or coalesce(array_length(v_team_ids,1),0)<>v_raw_team_count then return jsonb_build_object('status','unsupported','reason_code','invalid_or_duplicate_structural_team_set','club_id',null); end if;
  v_evidence_name_status := coalesce(nullif(p_organization->>'evidence_team_name_status',''),'unknown');
  if coalesce(p_organization->>'evidence_team_id_raw','') ~ '^[0-9]+$' then v_evidence_team_id := (p_organization->>'evidence_team_id_raw')::integer; else v_evidence_team_id := null; end if;
  v_evidence_name := nullif(btrim(p_organization->>'evidence_team_name_raw'),'');
  select exists(select 1 from public.club_structural_team_links l where l.save_id=p_save_id and l.owner_id=p_owner_id and l.structural_team_id=any(v_team_ids) and l.link_status='conflicting') into v_has_conflicting_link;
  select count(distinct l.club_id),min(l.club_id::text)::uuid into v_candidate_count,v_candidate_club from public.club_structural_team_links l where l.save_id=p_save_id and l.owner_id=p_owner_id and l.structural_team_id=any(v_team_ids) and l.link_status in ('confirmed','legacy_candidate') and l.club_id is not null;
  if v_has_conflicting_link or v_candidate_count>1 then return jsonb_build_object('status','ambiguous','reason_code','multiple_structural_team_club_candidates','candidate_count',v_candidate_count,'club_id',null); end if;
  if v_candidate_count=1 then
    v_club := v_candidate_club;
  else
    if v_evidence_name_status<>'confirmed' or v_evidence_name is null or v_evidence_team_id is null or not (v_evidence_team_id=any(v_team_ids)) then return jsonb_build_object('status','unknown','reason_code','safe_display_name_unavailable','club_id',null); end if;
    select count(*) into v_name_collision_count from public.clubs c where c.save_id=p_save_id and c.owner_id=p_owner_id and c.normalized_name=public.datatracker_normalize_longitudinal_name(v_evidence_name);
    if v_name_collision_count>0 then
      select count(*),min(c.id::text)::uuid into v_provenance_candidate_count,v_provenance_candidate_club
      from public.clubs c
      cross join lateral (select array_agg(distinct t.value::integer order by t.value::integer) team_ids,count(*) raw_count from jsonb_array_elements_text(c.provenance->'organization_team_ids') t(value) where t.value ~ '^[0-9]+$' and t.value::bigint>0 and t.value::bigint<100000) stored
      where c.save_id=p_save_id and c.owner_id=p_owner_id and c.normalized_name=public.datatracker_normalize_longitudinal_name(v_evidence_name) and c.provenance->>'resolution_method'='e-mc-01b-structural-organization-created' and jsonb_typeof(c.provenance->'organization_team_ids')='array' and stored.raw_count=jsonb_array_length(c.provenance->'organization_team_ids') and stored.team_ids=v_team_ids;
      if v_provenance_candidate_count=1 then v_club:=v_provenance_candidate_club; v_recovered_from_provenance:=true;
      elsif v_provenance_candidate_count>1 then return jsonb_build_object('status','ambiguous','reason_code','multiple_exact_structural_provenance_candidates','candidate_count',v_provenance_candidate_count,'club_id',null);
      else return jsonb_build_object('status','unknown','reason_code','unlinked_name_collision_blocks_creation','name_collision_count',v_name_collision_count,'club_id',null); end if;
    else
      insert into public.clubs(save_id,owner_id,fm_club_id,name,normalized_name,source_kind,source_import_id,provenance)
      values(p_save_id,p_owner_id,null,v_evidence_name,public.datatracker_normalize_longitudinal_name(v_evidence_name),'fm',p_import_id,jsonb_build_object('source_import_id',p_import_id,'source_snapshot_id',p_snapshot_id,'source_player_id',p_player_id,'resolution_method','e-mc-01b-structural-organization-created','organization_ref',v_org_ref,'organization_team_ids',to_jsonb(v_team_ids),'display_name_source_team_id',v_evidence_team_id,'public_club_uid_status','unknown')) returning id into v_club;
    end if;
  end if;
  foreach v_team in array v_team_ids loop
    select * into v_existing from public.club_structural_team_link_evidence e where e.save_id=p_save_id and e.owner_id=p_owner_id and e.structural_team_id=v_team and e.evidence_key=v_evidence_key limit 1 for update;
    if found then
      if v_existing.evidence_status<>'confirmed' or v_existing.club_id is distinct from v_club or v_existing.organization_ref is distinct from v_org_ref or v_existing.organization_team_ids is distinct from v_team_ids then raise exception 'E-MC-01B same-source structural evidence conflict for Team %',v_team; end if;
    else
      insert into public.club_structural_team_link_evidence(save_id,owner_id,structural_team_id,club_id,evidence_status,evidence_key,organization_ref,organization_team_ids,display_name_raw,source_import_id,source_snapshot_id,source_player_id,source_kind,provenance)
      values(p_save_id,p_owner_id,v_team,v_club,'confirmed',v_evidence_key,v_org_ref,v_team_ids,v_evidence_name,p_import_id,p_snapshot_id,p_player_id,'fm',jsonb_build_object('resolution_method','membership_facts_v1_confirmed_organization','membership_facts_sync_version','e-mc-01b-v1','display_name_source_team_id',v_evidence_team_id,'display_name_status',v_evidence_name_status,'public_club_uid_status','unknown'));
    end if;
    perform public.datatracker_rebuild_structural_team_link(p_save_id,p_owner_id,v_team);
  end loop;
  return jsonb_build_object('status','confirmed','reason_code',case when v_candidate_count=1 then 'unique_structural_registry_candidate' when v_recovered_from_provenance then 'recovered_from_exact_structural_provenance' else 'created_from_safe_structural_name_evidence' end,'club_id',v_club,'organization_ref',v_org_ref,'structural_team_ids',to_jsonb(v_team_ids));
end
$$;

with structural_clubs as (
  select c.id club_id,c.save_id,c.owner_id,c.name,nullif(c.provenance->>'organization_ref','') organization_ref,ids.team_ids
  from public.clubs c
  cross join lateral (select array_agg(distinct t.value::integer order by t.value::integer) team_ids,count(*) raw_count from jsonb_array_elements_text(c.provenance->'organization_team_ids') t(value) where t.value ~ '^[0-9]+$' and t.value::bigint>0 and t.value::bigint<100000) ids
  where c.provenance->>'resolution_method'='e-mc-01b-structural-organization-created' and jsonb_typeof(c.provenance->'organization_team_ids')='array' and ids.raw_count=jsonb_array_length(c.provenance->'organization_team_ids') and coalesce(cardinality(ids.team_ids),0)>0
), seed as (
  insert into public.club_structural_team_link_evidence(save_id,owner_id,structural_team_id,club_id,evidence_status,evidence_key,organization_ref,organization_team_ids,display_name_raw,source_import_id,source_snapshot_id,source_player_id,source_kind,provenance)
  select c.save_id,c.owner_id,team_id,c.club_id,'confirmed','club-provenance:'||c.club_id::text,c.organization_ref,c.team_ids,c.name,null,null,null,'fm',jsonb_build_object('resolution_method','e-mc-01b-surviving-club-provenance','membership_facts_sync_version','e-mc-01b-v1','public_club_uid_status','unknown') from structural_clubs c cross join lateral unnest(c.team_ids) team_id
  on conflict(save_id,structural_team_id,evidence_key) do nothing returning save_id,owner_id,structural_team_id
) select count(*) from seed;

do $$ declare r record; begin
  for r in select distinct c.save_id,c.owner_id,team_id structural_team_id from public.clubs c cross join lateral (select array_agg(distinct t.value::integer order by t.value::integer) team_ids,count(*) raw_count from jsonb_array_elements_text(c.provenance->'organization_team_ids') t(value) where t.value ~ '^[0-9]+$' and t.value::bigint>0 and t.value::bigint<100000) ids cross join lateral unnest(ids.team_ids) team_id where c.provenance->>'resolution_method'='e-mc-01b-structural-organization-created' and jsonb_typeof(c.provenance->'organization_team_ids')='array' and ids.raw_count=jsonb_array_length(c.provenance->'organization_team_ids') loop perform public.datatracker_rebuild_structural_team_link(r.save_id,r.owner_id,r.structural_team_id); end loop;
end $$;

with repair as (
  select m.id,l.club_id,(m.is_loan=true and m.loan_from_club_id is null and m.provenance#>>'{factual_fields,loan_from_organization,binding_reason_code}'='unlinked_name_collision_blocks_creation') repair_loan_from
  from public.player_memberships m join public.club_structural_team_links l on l.save_id=m.save_id and l.owner_id=m.owner_id and l.link_status='confirmed' and l.structural_team_id=(m.provenance#>>'{contract_facts,current_standard_contract,value,team_id_raw}')::integer
  where m.owner_club_id is null and m.provenance#>>'{factual_fields,owner_organization,status}'='confirmed' and m.provenance#>>'{factual_fields,owner_organization,binding_reason_code}'='unlinked_name_collision_blocks_creation' and coalesce(m.provenance#>>'{contract_facts,current_standard_contract,value,team_id_raw}','') ~ '^[0-9]+$'
)
update public.player_memberships m set owner_club_id=r.club_id,loan_from_club_id=case when r.repair_loan_from then r.club_id else m.loan_from_club_id end,
provenance=case when r.repair_loan_from then jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(m.provenance,'{factual_fields,owner_organization,club_id}',to_jsonb(r.club_id::text),true),'{factual_fields,owner_organization,binding_status}','"confirmed"'::jsonb,true),'{factual_fields,owner_organization,binding_reason_code}','"reconciled_exact_structural_provenance"'::jsonb,true),'{factual_fields,loan_from_organization,club_id}',to_jsonb(r.club_id::text),true),'{factual_fields,loan_from_organization,binding_status}','"confirmed"'::jsonb,true),'{factual_fields,loan_from_organization,binding_reason_code}','"reconciled_exact_structural_provenance"'::jsonb,true)
else jsonb_set(jsonb_set(jsonb_set(m.provenance,'{factual_fields,owner_organization,club_id}',to_jsonb(r.club_id::text),true),'{factual_fields,owner_organization,binding_status}','"confirmed"'::jsonb,true),'{factual_fields,owner_organization,binding_reason_code}','"reconciled_exact_structural_provenance"'::jsonb,true) end
from repair r where m.id=r.id;

do $$ declare v_current text; v_definition text; v_updated text; begin v_current:=public.datatracker_schema_info()->>'app_version'; if v_current='0.29.6' then return; end if; if v_current<>'0.29.5' then raise exception 'Unexpected DataTracker app marker %, expected 0.29.5 before v0.29.6 structural rebind',v_current; end if; select pg_get_functiondef('public.datatracker_schema_info()'::regprocedure) into v_definition; v_updated:=replace(v_definition,'''app_version'',''0.29.5''','''app_version'',''0.29.6'''); if v_updated=v_definition then raise exception 'Could not locate canonical 0.29.5 app marker'; end if; execute v_updated; end $$;

notify pgrst,'reload schema';

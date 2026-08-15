create table if not exists public.contracts(id uuid primary key default gen_random_uuid(),player_id uuid not null references public.players(id) on delete cascade,owner_id uuid not null references auth.users(id) on delete cascade,snapshot_date date not null,expiry_date date,wage numeric,release_clause numeric,release_clause_type text,squad_status text,notes text,created_at timestamptz not null default now(),unique(player_id,snapshot_date));
alter table public.contracts enable row level security;
create policy contracts_owner on public.contracts for all using(owner_id=auth.uid()) with check(owner_id=auth.uid());

create or replace function public.import_fm_export(p_save_id uuid,p_filename text,p_file_type text,p_snapshot_date date,p_file_hash text,p_delimiter text,p_warnings jsonb,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_owner uuid:=auth.uid();v_import uuid;v_row jsonb;v_player uuid;v_snapshot uuid;v_attr jsonb;v_new int:=0;v_updated int:=0;
begin
 if v_owner is null then raise exception 'Usuário não autenticado';end if;
 if not exists(select 1 from saves where id=p_save_id and owner_id=v_owner)then raise exception 'Save não encontrado';end if;
 if exists(select 1 from imports where save_id=p_save_id and file_hash=p_file_hash)then return jsonb_build_object('duplicate',true,'new_players',0,'updated_players',0);end if;
 insert into imports(save_id,owner_id,original_filename,file_type,snapshot_date,file_hash,row_count,delimiter,parser_profile,warnings,status)
 values(p_save_id,v_owner,p_filename,p_file_type,p_snapshot_date,p_file_hash,jsonb_array_length(p_rows),p_delimiter,'manual-date',p_warnings,'parsed') returning id into v_import;
 for v_row in select * from jsonb_array_elements(p_rows) loop
  select id into v_player from players where save_id=p_save_id and identity_key=v_row->>'identity_key';
  if v_player is null and nullif(v_row->>'fm_player_id','') is null and (select count(*) from players where save_id=p_save_id and normalized_name=v_row->>'normalized_name')=1 then
   select id into v_player from players where save_id=p_save_id and normalized_name=v_row->>'normalized_name' limit 1;
  end if;
  if v_player is null then
   insert into players(save_id,owner_id,fm_player_id,identity_key,current_name,normalized_name,date_of_birth,nationality,original_first_seen_name,first_seen_date,last_seen_date)
   values(p_save_id,v_owner,nullif(v_row->>'fm_player_id',''),v_row->>'identity_key',v_row->>'current_name',v_row->>'normalized_name',nullif(v_row->>'date_of_birth','')::date,v_row->>'nationality',v_row->>'current_name',p_snapshot_date,p_snapshot_date) returning id into v_player;v_new:=v_new+1;
  else update players set current_name=v_row->>'current_name',nationality=coalesce(v_row->>'nationality',nationality),last_seen_date=greatest(last_seen_date,p_snapshot_date),updated_at=now(),is_active=true where id=v_player;v_updated:=v_updated+1;end if;
  if p_file_type in('squad','intake')then
   insert into player_snapshots(player_id,save_id,import_id,snapshot_date,age,club,squad,positions,contract_expiry,raw_data,normalized_data)
   values(v_player,p_save_id,v_import,p_snapshot_date,nullif(v_row->>'age','')::numeric,v_row->>'club',v_row->>'squad',coalesce(v_row->'positions','[]'),nullif(v_row->>'contract_expiry','')::date,coalesce(v_row->'raw_data','{}'),coalesce(v_row->'normalized_data','{}')) returning id into v_snapshot;
   for v_attr in select * from jsonb_array_elements(coalesce(v_row->'attributes','[]'))loop insert into player_attributes(player_snapshot_id,attribute_key,attribute_label,value,source_column,category)values(v_snapshot,v_attr->>'attribute_key',v_attr->>'attribute_label',(v_attr->>'value')::numeric,v_attr->>'source_column',v_attr->>'category');end loop;
   if nullif(v_row->>'contract_expiry','')is not null then insert into contracts(player_id,owner_id,snapshot_date,expiry_date)values(v_player,v_owner,p_snapshot_date,(v_row->>'contract_expiry')::date)on conflict(player_id,snapshot_date)do update set expiry_date=excluded.expiry_date;end if;
  else insert into player_stats(player_id,save_id,import_id,snapshot_date,minutes,appearances,raw_stats,normalized_stats)values(v_player,p_save_id,v_import,p_snapshot_date,nullif(v_row->>'minutes','')::numeric,nullif(v_row->>'appearances','')::numeric,coalesce(v_row->'raw_data','{}'),coalesce(v_row->'normalized_data','{}'));end if;
 end loop;
 update imports set status='imported' where id=v_import;
 return jsonb_build_object('duplicate',false,'import_id',v_import,'new_players',v_new,'updated_players',v_updated,'rows',jsonb_array_length(p_rows));
end$$;

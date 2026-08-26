-- FM DataTracker v0.25.0
-- Restores the public Model Lab patch contract and exposes an explicit schema marker.
-- Safe to apply after 202608250001_import_integrity.sql; existing migrations remain immutable.

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

create or replace function public.datatracker_schema_info()
returns jsonb
language sql
stable
security invoker
set search_path=public
as $$
  select jsonb_build_object(
    'schema_version','202608260001',
    'app_version','0.25.0',
    'features',jsonb_build_array('patch_scoring_model_config','delete_fm_import','schema_version_marker')
  );
$$;

notify pgrst, 'reload schema';

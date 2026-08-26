-- FM DataTracker v0.25.1
-- Canonical Model Lab identity, stronger ownership checks and atomic merge/upsert.
-- Apply after 202608260001_model_config_compatibility.sql.

-- Existing duplicate active models are consolidated deterministically before the
-- unique index is created. The oldest row remains canonical; later configs are
-- merged in chronological order so newer values win only for overlapping keys.
do $$
declare
  v_group record;
  v_row record;
  v_canonical uuid;
  v_config jsonb;
  v_version text;
begin
  for v_group in
    select owner_id,save_id,name
    from public.scoring_models
    where is_active=true and save_id is not null
    group by owner_id,save_id,name
    having count(*) > 1
  loop
    select id,coalesce(config,'{}'::jsonb),version
      into v_canonical,v_config,v_version
    from public.scoring_models
    where owner_id=v_group.owner_id
      and save_id=v_group.save_id
      and name=v_group.name
      and is_active=true
    order by created_at,id
    limit 1;

    for v_row in
      select id,coalesce(config,'{}'::jsonb) as config,version
      from public.scoring_models
      where owner_id=v_group.owner_id
        and save_id=v_group.save_id
        and name=v_group.name
        and is_active=true
        and id<>v_canonical
      order by created_at,id
    loop
      v_config := v_config || v_row.config;
      v_version := coalesce(v_row.version,v_version);
    end loop;

    update public.scoring_models
      set config=v_config,version=v_version
      where id=v_canonical;

    update public.scoring_models
      set is_active=false
      where owner_id=v_group.owner_id
        and save_id=v_group.save_id
        and name=v_group.name
        and is_active=true
        and id<>v_canonical;
  end loop;
end
$$;

create unique index if not exists scoring_models_active_save_name_uidx
  on public.scoring_models(owner_id,save_id,name)
  where is_active=true and save_id is not null;

-- The direct compatibility path must prove both row ownership and ownership of
-- the referenced save. Global user-owned models with save_id null remain valid.
drop policy if exists models_owner on public.scoring_models;
create policy models_owner on public.scoring_models
for all
using (
  owner_id=auth.uid()
  and (
    save_id is null
    or exists(select 1 from public.saves s where s.id=save_id and s.owner_id=auth.uid())
  )
)
with check (
  owner_id=auth.uid()
  and (
    save_id is null
    or exists(select 1 from public.saves s where s.id=save_id and s.owner_id=auth.uid())
  )
);

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

  insert into scoring_models(owner_id,save_id,name,version,config,is_active)
  values(v_owner,p_save_id,p_name,p_version,p_patch,true)
  on conflict (owner_id,save_id,name)
    where is_active=true and save_id is not null
  do update set
    config=coalesce(scoring_models.config,'{}'::jsonb)||excluded.config,
    version=excluded.version,
    is_active=true
  returning id,config into v_model,v_config;

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
    'schema_version','202608260002',
    'app_version','0.25.1',
    'features',jsonb_build_array(
      'patch_scoring_model_config',
      'delete_fm_import',
      'schema_version_marker',
      'canonical_model_lab_identity',
      'scoring_models_save_ownership_rls'
    )
  );
$$;

notify pgrst, 'reload schema';

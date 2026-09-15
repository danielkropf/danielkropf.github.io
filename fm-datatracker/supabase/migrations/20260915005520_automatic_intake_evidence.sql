-- Intake evidence is independent of mutable squad membership and of UID-only player identity.
create table public.fm_intake_observations (
 id uuid primary key default gen_random_uuid(),
 save_id uuid not null references public.saves(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 source_import_id uuid,
 foreign key(source_import_id,save_id) references public.imports(id,save_id) on delete set null(source_import_id),
 source_hash text not null,
 checkpoint_date date not null,
 cohort_key text not null,
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 reader_version text not null,
 created_at timestamptz not null default now(),
 unique(save_id,source_hash,cohort_key)
);
create index fm_intake_observations_import_idx on public.fm_intake_observations(source_import_id);
create index fm_intake_observations_owner_idx on public.fm_intake_observations(owner_id);
create table public.fm_intake_reviews (
 save_id uuid not null references public.saves(id) on delete cascade,
 cohort_key text not null,
 owner_id uuid not null references auth.users(id) on delete cascade,
 decision text not null check(decision in ('confirmed','rejected')),
 reviewed_at timestamptz not null default now(),
 primary key(save_id,cohort_key)
);
create index fm_intake_reviews_owner_idx on public.fm_intake_reviews(owner_id);
alter table public.fm_intake_observations enable row level security;
alter table public.fm_intake_reviews enable row level security;
create policy intake_observation_owner on public.fm_intake_observations for all to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.saves s where s.id=save_id and s.owner_id=(select auth.uid())))
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.saves s where s.id=save_id and s.owner_id=(select auth.uid())));
create policy intake_review_owner on public.fm_intake_reviews for all to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.saves s where s.id=save_id and s.owner_id=(select auth.uid())))
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.saves s where s.id=save_id and s.owner_id=(select auth.uid())));
grant select,insert,update,delete on public.fm_intake_observations,public.fm_intake_reviews to authenticated;

create function public.import_fm_with_intakes(
 p_save_id uuid,p_filename text,p_file_type text,p_snapshot_date date,p_file_hash text,
 p_delimiter text,p_warnings jsonb,p_rows jsonb,p_intakes jsonb
) returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='55s' as $$
declare v_owner uuid:=auth.uid(); v_result jsonb; v_e jsonb; v_m jsonb; v_key text; v_count integer:=0;
begin
 if v_owner is null then raise exception 'Usuário não autenticado'; end if;
 perform 1 from public.saves where id=p_save_id and owner_id=v_owner for update;
 if not found then raise exception 'Save não encontrado'; end if;
 if p_intakes->>'version' is distinct from 'fm26-intakes-v1'
   or jsonb_typeof(p_intakes->'classes') is distinct from 'array'
   or (p_intakes->>'checkpoint_date')::date is distinct from p_snapshot_date
   or jsonb_array_length(p_intakes->'classes')>128 then raise exception 'Evidência de intake inválida'; end if;
 -- Refuse to overwrite a different biography just because the binary UID matches.
 if exists(select 1 from jsonb_array_elements(p_rows) r join public.players p
   on p.save_id=p_save_id and p.fm_player_id=r->>'fm_player_id'
   where p.date_of_birth is not null and nullif(r->>'date_of_birth','') is not null
     and p.date_of_birth<>(r->>'date_of_birth')::date) then
   raise exception 'Conflito de identidade: um UID já pertence a outra data de nascimento. Use um save separado para esta ramificação; nenhum dado foi alterado.';
 end if;
 v_result:=public.import_fm_export(p_save_id,p_filename,p_file_type,p_snapshot_date,p_file_hash,p_delimiter,p_warnings,p_rows);
 for v_e in select value from jsonb_array_elements(p_intakes->'classes') loop
   v_key:=(v_e->>'team_id')||':'||(v_e->>'intake_date');
   if nullif(v_e->>'team_id','') is null or nullif(v_e->>'intake_date','') is null or nullif(v_e->>'confidence','') is null or nullif(v_e->>'method','') is null or (v_e->>'team_id')::bigint<=0 or v_e->>'key' is distinct from v_key
     or (v_e->>'intake_date')::date>p_snapshot_date
     or v_e->>'confidence' not in ('candidate','supported')
     or v_e->>'method' not in ('trial_42_days','news_envelope_and_trial_cohort')
     or jsonb_typeof(v_e->'members') is distinct from 'array'
     or jsonb_array_length(v_e->'members') not between 1 and 128
     then raise exception 'Turma de intake inválida'; end if;
   for v_m in select value from jsonb_array_elements(v_e->'members') loop
     if nullif(v_m->>'uid','') is null or nullif(v_m->>'name','') is null
       or nullif(v_m->>'birth_date','') is null or (v_m->>'birth_date')::date >= (v_e->>'intake_date')::date
       then raise exception 'Identidade de intake incompleta'; end if;
   end loop;
   insert into public.fm_intake_observations(save_id,owner_id,source_import_id,source_hash,checkpoint_date,cohort_key,evidence,reader_version)
   values(p_save_id,v_owner,(v_result->>'import_id')::uuid,p_file_hash,p_snapshot_date,v_key,v_e,p_intakes->>'version')
   on conflict(save_id,source_hash,cohort_key) do update set evidence=case when fm_intake_observations.evidence->>'confidence'='supported' and excluded.evidence->>'confidence'='candidate' then fm_intake_observations.evidence else excluded.evidence end,reader_version=excluded.reader_version,source_import_id=excluded.source_import_id;
   v_count:=v_count+1;
 end loop;
 return v_result||jsonb_build_object('intake_observations',v_count);
end $$;
revoke all on function public.import_fm_with_intakes(uuid,text,text,date,text,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.import_fm_with_intakes(uuid,text,text,date,text,text,jsonb,jsonb,jsonb) to authenticated;

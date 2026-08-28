-- FM DataTracker — database integrity hardening
-- 2026-08-27

-- 1) Parent keys required for composite foreign keys.
alter table public.saves
  add constraint saves_id_owner_id_key unique (id, owner_id);

alter table public.players
  add constraint players_id_owner_id_key unique (id, owner_id),
  add constraint players_id_save_id_key unique (id, save_id);

alter table public.imports
  add constraint imports_id_save_id_key unique (id, save_id);

alter table public.player_snapshots
  add constraint player_snapshots_id_player_id_save_id_key unique (id, player_id, save_id);

-- 2) Database-level relational integrity across owner/save/player/import/snapshot.
alter table public.players
  add constraint players_save_owner_fkey
    foreign key (save_id, owner_id)
    references public.saves (id, owner_id)
    on delete cascade;

alter table public.imports
  add constraint imports_save_owner_fkey
    foreign key (save_id, owner_id)
    references public.saves (id, owner_id)
    on delete cascade;

alter table public.role_models
  add constraint role_models_save_owner_fkey
    foreign key (save_id, owner_id)
    references public.saves (id, owner_id)
    on delete cascade;

alter table public.scoring_models
  add constraint scoring_models_save_owner_fkey
    foreign key (save_id, owner_id)
    references public.saves (id, owner_id)
    on delete cascade;

alter table public.decisions
  add constraint decisions_save_owner_fkey
    foreign key (save_id, owner_id)
    references public.saves (id, owner_id)
    on delete cascade,
  add constraint decisions_player_save_fkey
    foreign key (player_id, save_id)
    references public.players (id, save_id)
    on delete cascade;

alter table public.contracts
  add constraint contracts_player_owner_fkey
    foreign key (player_id, owner_id)
    references public.players (id, owner_id)
    on delete cascade;

alter table public.player_snapshots
  add constraint player_snapshots_player_save_fkey
    foreign key (player_id, save_id)
    references public.players (id, save_id)
    on delete cascade,
  add constraint player_snapshots_import_save_fkey
    foreign key (import_id, save_id)
    references public.imports (id, save_id)
    on delete cascade;

alter table public.player_stats
  add constraint player_stats_player_save_fkey
    foreign key (player_id, save_id)
    references public.players (id, save_id)
    on delete cascade,
  add constraint player_stats_import_save_fkey
    foreign key (import_id, save_id)
    references public.imports (id, save_id)
    on delete cascade;

alter table public.player_projections
  add constraint player_projections_player_save_fkey
    foreign key (player_id, save_id)
    references public.players (id, save_id)
    on delete cascade,
  add constraint player_projections_snapshot_player_save_fkey
    foreign key (snapshot_id, player_id, save_id)
    references public.player_snapshots (id, player_id, save_id)
    on delete cascade;

-- 3) Harden and optimize RLS. Restrict policies to authenticated and cache auth.uid() per statement.
drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists saves_owner on public.saves;
create policy saves_owner on public.saves
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists imports_owner on public.imports;
create policy imports_owner on public.imports
  for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.saves s
      where s.id = imports.save_id
        and s.owner_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.saves s
      where s.id = imports.save_id
        and s.owner_id = (select auth.uid())
    )
  );

drop policy if exists players_owner on public.players;
create policy players_owner on public.players
  for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.saves s
      where s.id = players.save_id
        and s.owner_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.saves s
      where s.id = players.save_id
        and s.owner_id = (select auth.uid())
    )
  );

drop policy if exists snapshots_owner on public.player_snapshots;
create policy snapshots_owner on public.player_snapshots
  for all to authenticated
  using (
    exists (
      select 1
      from public.saves s
      join public.players p on p.id = player_snapshots.player_id and p.save_id = s.id
      join public.imports i on i.id = player_snapshots.import_id and i.save_id = s.id
      where s.id = player_snapshots.save_id
        and s.owner_id = (select auth.uid())
        and p.owner_id = (select auth.uid())
        and i.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.saves s
      join public.players p on p.id = player_snapshots.player_id and p.save_id = s.id
      join public.imports i on i.id = player_snapshots.import_id and i.save_id = s.id
      where s.id = player_snapshots.save_id
        and s.owner_id = (select auth.uid())
        and p.owner_id = (select auth.uid())
        and i.owner_id = (select auth.uid())
    )
  );

drop policy if exists attributes_owner on public.player_attributes;
create policy attributes_owner on public.player_attributes
  for all to authenticated
  using (
    exists (
      select 1
      from public.player_snapshots ps
      join public.saves s on s.id = ps.save_id
      where ps.id = player_attributes.player_snapshot_id
        and s.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.player_snapshots ps
      join public.saves s on s.id = ps.save_id
      where ps.id = player_attributes.player_snapshot_id
        and s.owner_id = (select auth.uid())
    )
  );

drop policy if exists stats_owner on public.player_stats;
create policy stats_owner on public.player_stats
  for all to authenticated
  using (
    exists (
      select 1
      from public.saves s
      join public.players p on p.id = player_stats.player_id and p.save_id = s.id
      join public.imports i on i.id = player_stats.import_id and i.save_id = s.id
      where s.id = player_stats.save_id
        and s.owner_id = (select auth.uid())
        and p.owner_id = (select auth.uid())
        and i.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.saves s
      join public.players p on p.id = player_stats.player_id and p.save_id = s.id
      join public.imports i on i.id = player_stats.import_id and i.save_id = s.id
      where s.id = player_stats.save_id
        and s.owner_id = (select auth.uid())
        and p.owner_id = (select auth.uid())
        and i.owner_id = (select auth.uid())
    )
  );

drop policy if exists roles_owner on public.role_models;
create policy roles_owner on public.role_models
  for all to authenticated
  using (
    owner_id = (select auth.uid())
    and (
      save_id is null
      or exists (
        select 1 from public.saves s
        where s.id = role_models.save_id
          and s.owner_id = (select auth.uid())
      )
    )
  )
  with check (
    owner_id = (select auth.uid())
    and (
      save_id is null
      or exists (
        select 1 from public.saves s
        where s.id = role_models.save_id
          and s.owner_id = (select auth.uid())
      )
    )
  );

drop policy if exists models_owner on public.scoring_models;
create policy models_owner on public.scoring_models
  for all to authenticated
  using (
    owner_id = (select auth.uid())
    and (
      save_id is null
      or exists (
        select 1 from public.saves s
        where s.id = scoring_models.save_id
          and s.owner_id = (select auth.uid())
      )
    )
  )
  with check (
    owner_id = (select auth.uid())
    and (
      save_id is null
      or exists (
        select 1 from public.saves s
        where s.id = scoring_models.save_id
          and s.owner_id = (select auth.uid())
      )
    )
  );

drop policy if exists scores_owner on public.player_scores;
create policy scores_owner on public.player_scores
  for all to authenticated
  using (
    exists (
      select 1
      from public.players p
      join public.scoring_models sm on sm.id = player_scores.scoring_model_id
      left join public.role_models rm on rm.id = player_scores.role_model_id
      where p.id = player_scores.player_id
        and p.owner_id = (select auth.uid())
        and sm.owner_id = (select auth.uid())
        and (sm.save_id is null or sm.save_id = p.save_id)
        and (
          player_scores.role_model_id is null
          or (
            rm.id is not null
            and rm.owner_id = (select auth.uid())
            and (rm.save_id is null or rm.save_id = p.save_id)
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.players p
      join public.scoring_models sm on sm.id = player_scores.scoring_model_id
      left join public.role_models rm on rm.id = player_scores.role_model_id
      where p.id = player_scores.player_id
        and p.owner_id = (select auth.uid())
        and sm.owner_id = (select auth.uid())
        and (sm.save_id is null or sm.save_id = p.save_id)
        and (
          player_scores.role_model_id is null
          or (
            rm.id is not null
            and rm.owner_id = (select auth.uid())
            and (rm.save_id is null or rm.save_id = p.save_id)
          )
        )
    )
  );

drop policy if exists decisions_owner on public.decisions;
create policy decisions_owner on public.decisions
  for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.saves s
      where s.id = decisions.save_id
        and s.owner_id = (select auth.uid())
    )
    and (
      player_id is null
      or exists (
        select 1 from public.players p
        where p.id = decisions.player_id
          and p.save_id = decisions.save_id
          and p.owner_id = (select auth.uid())
      )
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.saves s
      where s.id = decisions.save_id
        and s.owner_id = (select auth.uid())
    )
    and (
      player_id is null
      or exists (
        select 1 from public.players p
        where p.id = decisions.player_id
          and p.save_id = decisions.save_id
          and p.owner_id = (select auth.uid())
      )
    )
  );

drop policy if exists mappings_owner on public.import_column_mappings;
create policy mappings_owner on public.import_column_mappings
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists contracts_owner on public.contracts;
create policy contracts_owner on public.contracts
  for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.players p
      where p.id = contracts.player_id
        and p.owner_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.players p
      where p.id = contracts.player_id
        and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists player_projections_owner on public.player_projections;
create policy player_projections_owner on public.player_projections
  for all to authenticated
  using (
    exists (
      select 1
      from public.saves s
      join public.players p
        on p.id = player_projections.player_id
       and p.save_id = s.id
      join public.player_snapshots ps
        on ps.id = player_projections.snapshot_id
       and ps.player_id = p.id
       and ps.save_id = s.id
      where s.id = player_projections.save_id
        and s.owner_id = (select auth.uid())
        and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.saves s
      join public.players p
        on p.id = player_projections.player_id
       and p.save_id = s.id
      join public.player_snapshots ps
        on ps.id = player_projections.snapshot_id
       and ps.player_id = p.id
       and ps.save_id = s.id
      where s.id = player_projections.save_id
        and s.owner_id = (select auth.uid())
        and p.owner_id = (select auth.uid())
    )
  );

-- 4) handle_new_user is trigger-only: pin search_path and remove direct client execution.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 5) Cover foreign keys that currently lack useful leading indexes.
create index if not exists contracts_owner_id_idx on public.contracts(owner_id);
create index if not exists decisions_owner_id_idx on public.decisions(owner_id);
create index if not exists decisions_player_id_idx on public.decisions(player_id);
create index if not exists decisions_save_id_idx on public.decisions(save_id);
create index if not exists import_column_mappings_owner_id_idx on public.import_column_mappings(owner_id);
create index if not exists imports_owner_id_idx on public.imports(owner_id);
create index if not exists player_projections_player_id_idx on public.player_projections(player_id);
create index if not exists player_projections_snapshot_id_idx on public.player_projections(snapshot_id);
create index if not exists player_scores_player_id_idx on public.player_scores(player_id);
create index if not exists player_scores_role_model_id_idx on public.player_scores(role_model_id);
create index if not exists player_scores_scoring_model_id_idx on public.player_scores(scoring_model_id);
create index if not exists player_snapshots_import_id_idx on public.player_snapshots(import_id);
create index if not exists player_snapshots_save_id_idx on public.player_snapshots(save_id);
create index if not exists player_stats_import_id_idx on public.player_stats(import_id);
create index if not exists player_stats_save_id_idx on public.player_stats(save_id);
create index if not exists players_owner_id_idx on public.players(owner_id);
create index if not exists role_models_owner_id_idx on public.role_models(owner_id);
create index if not exists role_models_save_id_idx on public.role_models(save_id);
create index if not exists saves_owner_id_idx on public.saves(owner_id);
create index if not exists scoring_models_save_id_idx on public.scoring_models(save_id);

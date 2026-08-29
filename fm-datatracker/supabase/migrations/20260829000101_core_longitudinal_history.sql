-- FM DataTracker — Phase 0A / 2 of 3
-- Core Longitudinal Domain: memberships, intake classes, events and decision links.

create table public.player_memberships (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  player_id uuid not null,
  observed_date date not null,
  season_id uuid,
  current_club_id uuid,
  owner_club_id uuid,
  team_level text not null default 'unknown' check (team_level in ('first_team','reserve','academy','other','unknown')),
  squad_name text,
  is_loan boolean,
  loan_from_club_id uuid,
  loan_to_club_id uuid,
  source_snapshot_id uuid,
  source_import_id uuid,
  source_kind text not null check (source_kind in ('fm','csv','manual','derived','legacy')),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint player_memberships_save_owner_fkey foreign key (save_id, owner_id)
    references public.saves(id, owner_id) on delete cascade,
  constraint player_memberships_player_save_owner_fkey foreign key (player_id, save_id, owner_id)
    references public.players(id, save_id, owner_id) on delete cascade,
  constraint player_memberships_season_save_owner_fkey foreign key (season_id, save_id, owner_id)
    references public.seasons(id, save_id, owner_id) on delete restrict,
  constraint player_memberships_current_club_save_owner_fkey foreign key (current_club_id, save_id, owner_id)
    references public.clubs(id, save_id, owner_id) on delete restrict,
  constraint player_memberships_owner_club_save_owner_fkey foreign key (owner_club_id, save_id, owner_id)
    references public.clubs(id, save_id, owner_id) on delete restrict,
  constraint player_memberships_loan_from_club_save_owner_fkey foreign key (loan_from_club_id, save_id, owner_id)
    references public.clubs(id, save_id, owner_id) on delete restrict,
  constraint player_memberships_loan_to_club_save_owner_fkey foreign key (loan_to_club_id, save_id, owner_id)
    references public.clubs(id, save_id, owner_id) on delete restrict,
  constraint player_memberships_snapshot_player_save_fkey foreign key (source_snapshot_id, player_id, save_id)
    references public.player_snapshots(id, player_id, save_id) on delete set null (source_snapshot_id),
  constraint player_memberships_import_save_fkey foreign key (source_import_id, save_id)
    references public.imports(id, save_id) on delete set null (source_import_id)
);

create unique index player_memberships_snapshot_observation_key
  on public.player_memberships(player_id, observed_date, source_snapshot_id)
  where source_snapshot_id is not null;
create index player_memberships_save_date_idx on public.player_memberships(save_id, observed_date desc);
create index player_memberships_player_date_idx on public.player_memberships(player_id, observed_date desc);
create index player_memberships_owner_id_idx on public.player_memberships(owner_id);
create index player_memberships_season_id_idx on public.player_memberships(season_id);
create index player_memberships_current_club_id_idx on public.player_memberships(current_club_id);
create index player_memberships_owner_club_id_idx on public.player_memberships(owner_club_id);
create index player_memberships_loan_from_club_id_idx on public.player_memberships(loan_from_club_id);
create index player_memberships_loan_to_club_id_idx on public.player_memberships(loan_to_club_id);
create index player_memberships_source_snapshot_id_idx on public.player_memberships(source_snapshot_id);
create index player_memberships_source_import_id_idx on public.player_memberships(source_import_id);

create table public.intake_classes (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  club_id uuid not null,
  season_id uuid,
  class_key text not null,
  label text not null,
  intake_date date,
  source_import_id uuid,
  source_kind text not null check (source_kind in ('fm','csv','manual','derived','legacy')),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intake_classes_id_save_owner_key unique (id, save_id, owner_id),
  constraint intake_classes_save_club_key_key unique (save_id, club_id, class_key),
  constraint intake_classes_save_owner_fkey foreign key (save_id, owner_id)
    references public.saves(id, owner_id) on delete cascade,
  constraint intake_classes_club_save_owner_fkey foreign key (club_id, save_id, owner_id)
    references public.clubs(id, save_id, owner_id) on delete restrict,
  constraint intake_classes_season_save_owner_fkey foreign key (season_id, save_id, owner_id)
    references public.seasons(id, save_id, owner_id) on delete restrict,
  constraint intake_classes_import_save_fkey foreign key (source_import_id, save_id)
    references public.imports(id, save_id) on delete set null (source_import_id)
);

create index intake_classes_owner_id_idx on public.intake_classes(owner_id);
create index intake_classes_club_id_idx on public.intake_classes(club_id);
create index intake_classes_season_id_idx on public.intake_classes(season_id);
create index intake_classes_source_import_id_idx on public.intake_classes(source_import_id);

create table public.intake_class_members (
  id uuid primary key default gen_random_uuid(),
  intake_class_id uuid not null,
  save_id uuid not null,
  owner_id uuid not null,
  player_id uuid not null,
  baseline_snapshot_id uuid,
  membership_status text not null default 'uncertain' check (membership_status in ('confirmed','uncertain')),
  source_import_id uuid,
  source_kind text not null check (source_kind in ('fm','csv','manual','derived','legacy')),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint intake_class_members_class_player_key unique (intake_class_id, player_id),
  constraint intake_class_members_save_owner_fkey foreign key (save_id, owner_id)
    references public.saves(id, owner_id) on delete cascade,
  constraint intake_class_members_class_save_owner_fkey foreign key (intake_class_id, save_id, owner_id)
    references public.intake_classes(id, save_id, owner_id) on delete cascade,
  constraint intake_class_members_player_save_owner_fkey foreign key (player_id, save_id, owner_id)
    references public.players(id, save_id, owner_id) on delete cascade,
  constraint intake_class_members_snapshot_player_save_fkey foreign key (baseline_snapshot_id, player_id, save_id)
    references public.player_snapshots(id, player_id, save_id) on delete set null (baseline_snapshot_id),
  constraint intake_class_members_import_save_fkey foreign key (source_import_id, save_id)
    references public.imports(id, save_id) on delete set null (source_import_id)
);

create index intake_class_members_save_id_idx on public.intake_class_members(save_id);
create index intake_class_members_owner_id_idx on public.intake_class_members(owner_id);
create index intake_class_members_player_id_idx on public.intake_class_members(player_id);
create index intake_class_members_baseline_snapshot_id_idx on public.intake_class_members(baseline_snapshot_id);
create index intake_class_members_source_import_id_idx on public.intake_class_members(source_import_id);

create table public.save_events (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  event_type text not null check (event_type in ('player_first_seen','player_inactive','membership_changed','intake_entry','contract_changed','planning_status_changed','manual_fact','transfer','loan')),
  event_date date not null,
  season_id uuid,
  club_id uuid,
  player_id uuid,
  intake_class_id uuid,
  source_kind text not null check (source_kind in ('fm','csv','manual','derived','legacy')),
  source_import_id uuid,
  source_snapshot_id uuid,
  derivation_version text,
  provenance jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint save_events_id_save_owner_key unique (id, save_id, owner_id),
  constraint save_events_derived_version_check check (source_kind <> 'derived' or derivation_version is not null),
  constraint save_events_snapshot_player_check check (source_snapshot_id is null or player_id is not null),
  constraint save_events_save_owner_fkey foreign key (save_id, owner_id)
    references public.saves(id, owner_id) on delete cascade,
  constraint save_events_season_save_owner_fkey foreign key (season_id, save_id, owner_id)
    references public.seasons(id, save_id, owner_id) on delete restrict,
  constraint save_events_club_save_owner_fkey foreign key (club_id, save_id, owner_id)
    references public.clubs(id, save_id, owner_id) on delete restrict,
  constraint save_events_player_save_owner_fkey foreign key (player_id, save_id, owner_id)
    references public.players(id, save_id, owner_id) on delete cascade,
  constraint save_events_class_save_owner_fkey foreign key (intake_class_id, save_id, owner_id)
    references public.intake_classes(id, save_id, owner_id) on delete restrict,
  constraint save_events_import_save_fkey foreign key (source_import_id, save_id)
    references public.imports(id, save_id) on delete set null (source_import_id),
  constraint save_events_snapshot_player_save_fkey foreign key (source_snapshot_id, player_id, save_id)
    references public.player_snapshots(id, player_id, save_id) on delete set null (source_snapshot_id)
);

create index save_events_save_date_idx on public.save_events(save_id, event_date desc);
create index save_events_owner_id_idx on public.save_events(owner_id);
create index save_events_season_id_idx on public.save_events(season_id);
create index save_events_club_date_idx on public.save_events(club_id, event_date desc);
create index save_events_player_date_idx on public.save_events(player_id, event_date desc);
create index save_events_intake_class_id_idx on public.save_events(intake_class_id);
create index save_events_source_import_id_idx on public.save_events(source_import_id);
create index save_events_source_snapshot_id_idx on public.save_events(source_snapshot_id);

create table public.event_decision_links (
  event_id uuid not null,
  decision_id uuid not null,
  save_id uuid not null,
  owner_id uuid not null,
  relation_type text not null check (relation_type in ('context','outcome')),
  created_at timestamptz not null default now(),
  primary key (event_id, decision_id),
  constraint event_decision_links_save_owner_fkey foreign key (save_id, owner_id)
    references public.saves(id, owner_id) on delete cascade,
  constraint event_decision_links_event_save_owner_fkey foreign key (event_id, save_id, owner_id)
    references public.save_events(id, save_id, owner_id) on delete cascade,
  constraint event_decision_links_decision_save_owner_fkey foreign key (decision_id, save_id, owner_id)
    references public.decisions(id, save_id, owner_id) on delete cascade
);

create index event_decision_links_decision_id_idx on public.event_decision_links(decision_id);
create index event_decision_links_save_id_idx on public.event_decision_links(save_id);
create index event_decision_links_owner_id_idx on public.event_decision_links(owner_id);

-- FM DataTracker — Phase 0A / 1 of 3
-- Core Longitudinal Domain: parent keys, Club, SaveClub and Season.
-- Additive only; legacy columns remain untouched.

alter table public.players
  add constraint players_id_save_id_owner_id_key unique (id, save_id, owner_id);

alter table public.decisions
  add constraint decisions_id_save_id_owner_id_key unique (id, save_id, owner_id);

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  fm_club_id text,
  name text not null,
  normalized_name text not null,
  country text,
  source_kind text not null check (source_kind in ('fm','csv','manual','derived','legacy')),
  source_import_id uuid,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clubs_id_save_owner_key unique (id, save_id, owner_id),
  constraint clubs_save_owner_fkey foreign key (save_id, owner_id)
    references public.saves(id, owner_id) on delete cascade,
  constraint clubs_source_import_save_fkey foreign key (source_import_id, save_id)
    references public.imports(id, save_id) on delete set null (source_import_id)
);

create unique index clubs_save_fm_club_id_key
  on public.clubs(save_id, fm_club_id)
  where fm_club_id is not null;
create index clubs_save_name_idx on public.clubs(save_id, normalized_name);
create index clubs_owner_id_idx on public.clubs(owner_id);
create index clubs_source_import_id_idx on public.clubs(source_import_id);

create table public.save_clubs (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  club_id uuid not null,
  tracking_role text not null default 'tracked' check (tracking_role in ('primary','tracked')),
  is_active boolean not null default true,
  display_order integer not null default 0,
  first_tracked_date date,
  last_tracked_date date,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint save_clubs_save_club_key unique (save_id, club_id),
  constraint save_clubs_dates_check check (
    first_tracked_date is null or last_tracked_date is null or last_tracked_date >= first_tracked_date
  ),
  constraint save_clubs_save_owner_fkey foreign key (save_id, owner_id)
    references public.saves(id, owner_id) on delete cascade,
  constraint save_clubs_club_save_owner_fkey foreign key (club_id, save_id, owner_id)
    references public.clubs(id, save_id, owner_id) on delete cascade
);

create unique index save_clubs_one_active_primary_per_save
  on public.save_clubs(save_id)
  where tracking_role='primary' and is_active;
create index save_clubs_owner_id_idx on public.save_clubs(owner_id);
create index save_clubs_club_id_idx on public.save_clubs(club_id);
create index save_clubs_save_active_order_idx on public.save_clubs(save_id, is_active, display_order);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null,
  owner_id uuid not null,
  season_key text not null,
  label text not null,
  ordinal integer,
  start_date date,
  end_date date,
  source_kind text not null check (source_kind in ('fm','csv','manual','derived','legacy')),
  source_import_id uuid,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seasons_id_save_owner_key unique (id, save_id, owner_id),
  constraint seasons_save_key_key unique (save_id, season_key),
  constraint seasons_dates_check check (start_date is null or end_date is null or end_date >= start_date),
  constraint seasons_save_owner_fkey foreign key (save_id, owner_id)
    references public.saves(id, owner_id) on delete cascade,
  constraint seasons_source_import_save_fkey foreign key (source_import_id, save_id)
    references public.imports(id, save_id) on delete set null (source_import_id)
);

create index seasons_owner_id_idx on public.seasons(owner_id);
create index seasons_source_import_id_idx on public.seasons(source_import_id);
create index seasons_save_ordinal_idx on public.seasons(save_id, ordinal);
create index seasons_save_dates_idx on public.seasons(save_id, start_date, end_date);

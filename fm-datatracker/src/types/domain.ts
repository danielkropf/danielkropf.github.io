export type ProvenanceSourceKind = 'fm' | 'csv' | 'manual' | 'derived' | 'legacy'
export type TeamLevel = 'first_team' | 'reserve' | 'academy' | 'other' | 'unknown'

export type Club = {
  id: string
  save_id: string
  owner_id: string
  fm_club_id: string | null
  name: string
  normalized_name: string
  country: string | null
  source_kind: ProvenanceSourceKind
  source_import_id: string | null
  provenance: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type SaveClub = {
  id: string
  save_id: string
  owner_id: string
  club_id: string
  tracking_role: 'primary' | 'tracked'
  is_active: boolean
  display_order: number
  first_tracked_date: string | null
  last_tracked_date: string | null
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type TrackedClub = SaveClub & { club: Club }

export type Season = {
  id: string
  save_id: string
  owner_id: string
  season_key: string
  label: string
  ordinal: number | null
  start_date: string | null
  end_date: string | null
  source_kind: ProvenanceSourceKind
  source_import_id: string | null
  provenance: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type PlayerMembership = {
  id: string
  save_id: string
  owner_id: string
  player_id: string
  observed_date: string
  season_id: string | null
  current_club_id: string | null
  owner_club_id: string | null
  team_level: TeamLevel
  squad_name: string | null
  is_loan: boolean | null
  loan_from_club_id: string | null
  loan_to_club_id: string | null
  source_snapshot_id: string | null
  source_import_id: string | null
  source_kind: ProvenanceSourceKind
  provenance: Record<string, unknown>
  created_at: string
}

export type PlayerMembershipWithClubs = PlayerMembership & {
  currentClub: Club | null
  ownerClub: Club | null
  loanFromClub: Club | null
  loanToClub: Club | null
}

export type IntakeClass = {
  id: string
  save_id: string
  owner_id: string
  club_id: string
  season_id: string | null
  class_key: string
  label: string
  intake_date: string | null
  source_import_id: string | null
  source_kind: ProvenanceSourceKind
  provenance: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type IntakeClassMember = {
  id: string
  intake_class_id: string
  save_id: string
  owner_id: string
  player_id: string
  baseline_snapshot_id: string | null
  membership_status: 'confirmed' | 'uncertain'
  source_import_id: string | null
  source_kind: ProvenanceSourceKind
  provenance: Record<string, unknown>
  created_at: string
}

export type SaveEventType =
  | 'player_first_seen'
  | 'player_inactive'
  | 'membership_changed'
  | 'intake_entry'
  | 'contract_changed'
  | 'planning_status_changed'
  | 'manual_fact'
  | 'transfer'
  | 'loan'

export type SaveEvent = {
  id: string
  save_id: string
  owner_id: string
  event_type: SaveEventType
  event_date: string
  season_id: string | null
  club_id: string | null
  player_id: string | null
  intake_class_id: string | null
  source_kind: ProvenanceSourceKind
  source_import_id: string | null
  source_snapshot_id: string | null
  derivation_version: string | null
  provenance: Record<string, unknown>
  payload: Record<string, unknown>
  created_at: string
}

export type ResolutionSource = 'normalized' | 'legacy' | 'unresolved'
export type LongitudinalResolution<T> = {
  value: T | null
  label: string | null
  source: ResolutionSource
  diagnostic: string | null
}

export type SaveStructure = {
  trackedClubs: TrackedClub[]
  seasons: Season[]
  primaryClub: LongitudinalResolution<Club>
  currentSeason: LongitudinalResolution<Season>
  diagnostic: string | null
}

export type Save = {
  id: string
  owner_id?: string
  name: string
  club_name: string
  country: string | null
  game_version: string | null
  save_type?: string
  current_season: string | null
  notes?: string | null
  created_at: string
  structure?: SaveStructure
}

export type ImportType = 'squad'|'stats'|'intake'|'unknown'
export type ImportPreview = { filename:string; fileType:ImportType; rowCount:number; delimiter:string; headers:string[]; ignoredColumns:string[]; warnings:string[]; rows:Record<string,string>[] }
export type PlayerRow = { id:string; current_name:string; nationality:string|null; last_seen_date:string; is_active:boolean; player_snapshots:Array<{id:string;snapshot_date:string;age:number|null;club:string|null;squad:string|null;positions:string[];contract_expiry:string|null;preferred_foot?:string|null;height?:number|null;weight?:number|null;raw_data:Record<string,unknown>;normalized_data:Record<string,unknown>;player_attributes:Array<{attribute_key:string;attribute_label:string;value:number;category:string}>}> }
export type ImportRecord = { id:string; original_filename:string; file_type:ImportType; snapshot_date:string; row_count:number; status:string; warnings:string[]; created_at:string }

export type Save = { id: string; name: string; club_name: string; country: string | null; game_version: string | null; current_season: string | null; created_at: string }
export type ImportType = 'squad' | 'stats' | 'intake' | 'unknown'
export type ImportPreview = { filename: string; fileType: ImportType; snapshotDate: string | null; rowCount: number; delimiter: string; headers: string[]; ignoredColumns: string[]; warnings: string[]; rows: Record<string, string>[] }

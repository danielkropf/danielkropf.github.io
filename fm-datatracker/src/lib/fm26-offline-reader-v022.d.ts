export interface FM26OfflineReaderV022Api {
  VERSION: string
  FMArchive: new (...args: unknown[]) => unknown
  GameDBReader: new (...args: unknown[]) => unknown
  PlayerStatsReader: new (...args: unknown[]) => unknown
  TeamLeagueHistoryReader: new (...args: unknown[]) => unknown
  TacticsReader: new (...args: unknown[]) => unknown
  FM26V1Reader: new (...args: unknown[]) => unknown
  readSaveBytes: (saveBytes: Uint8Array, fileName?: string, onStatus?: (status: string) => void) => Promise<unknown>
  constants: { POSITION_RATING_NAMES: string[]; ATTRIBUTE_NAMES: string[] }
}

export const FM26OfflineReaderV022: FM26OfflineReaderV022Api

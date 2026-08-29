import type { DataTableCapabilities } from './DataTable'

/**
 * Capability presets keep every player-data surface on the same table engine
 * while allowing each product surface to expose only the interactions it needs.
 */
export const DATA_TABLE_PRESETS = {
  squad: {
    sorting: true,
    resizing: true,
    reordering: true,
    freezing: true,
    selection: true,
  },
  tactics: {
    sorting: true,
    resizing: true,
    reordering: true,
    freezing: true,
    selection: false,
  },
  scouting: {
    sorting: true,
    resizing: true,
    reordering: true,
    freezing: true,
    selection: true,
  },
} as const satisfies Record<'squad' | 'tactics' | 'scouting', Required<DataTableCapabilities>>

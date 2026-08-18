export const DEFAULT_APPEARANCE = { scoreHigh: '#67e36f', scoreMid: '#f0c65a', scoreLow: '#ef7468', attributeHigh: '#67e36f', attributeMid: '#f0c65a', attributeLow: '#ef7468', gk: '#545477', d: '#00a099', dm: '#0b984c', m: '#2169b5', am: '#9122aa', st: '#c20d78' }
export type Appearance = typeof DEFAULT_APPEARANCE
const storageKey = 'fm-datatracker-appearance'
const variables: Record<keyof Appearance, string> = { scoreHigh: '--score-high', scoreMid: '--score-mid', scoreLow: '--score-low', attributeHigh: '--attribute-high', attributeMid: '--attribute-mid', attributeLow: '--attribute-low', gk: '--position-gk', d: '--position-d', dm: '--position-dm', m: '--position-m', am: '--position-am', st: '--position-st' }
export function applyAppearance(value: Appearance) { const root = document.documentElement; for (const [key, variable] of Object.entries(variables) as [keyof Appearance, string][]) root.style.setProperty(variable, value[key]) }
export function loadAppearance(): Appearance { try { return { ...DEFAULT_APPEARANCE, ...JSON.parse(localStorage.getItem(storageKey) ?? '{}') } } catch { return DEFAULT_APPEARANCE } }
export function saveAppearance(value: Appearance) { localStorage.setItem(storageKey, JSON.stringify(value)) }

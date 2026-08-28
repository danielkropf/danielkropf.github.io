export const PROJECTION_DISPLAY_MAX_AGE = 29

/**
 * Product/UI eligibility for showing a potential projection.
 *
 * Projection v2.1 can still be evaluated by research tooling at older ages,
 * but the DataTracker product does not present a peak-potential badge from age 30 onward.
 * Missing age remains visible so the projection engine can surface its existing
 * missing-age/provenance diagnostic instead of being silently hidden.
 */
export function shouldDisplayProjectionForAge(age: number | null | undefined) {
  if (age === null || age === undefined) return true
  return Number.isFinite(age) && age <= PROJECTION_DISPLAY_MAX_AGE
}

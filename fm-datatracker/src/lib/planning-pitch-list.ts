export const PLANNING_PITCH_LIST_CAPACITY = 3

function uniqueLabels(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

export function planningPitchSetHeader(position: string, ipRoles: string[], oopRoles: string[]) {
  const ip = uniqueLabels(ipRoles).join(' / ') || '—'
  const oop = uniqueLabels(oopRoles).join(' / ') || '—'
  return `${position} | IP: ${ip} - OOP: ${oop}`
}

import { describe, expect, it } from 'vitest'
import { countryFlagEmoji, currentRosterLabel, currentRosterStatus, isExternalCurrentClub, preferredTacticalPlanningGroupId } from './current-roster'

describe('current roster facts and planning context', () => {
  it('uses exact current-club facts and does not guess an unknown club as external', () => {
    expect(isExternalCurrentClub({ currentClubId: 'flu', primaryClubId: 'flu', currentClubName: 'Fluminense', primaryClubName: 'Fluminense' })).toBe(false)
    expect(isExternalCurrentClub({ currentClubId: 'bot', primaryClubId: 'flu', currentClubName: 'Botafogo', primaryClubName: 'Fluminense' })).toBe(true)
    expect(isExternalCurrentClub({ currentClubName: null, primaryClubName: 'Fluminense' })).toBe(false)
  })

  it('keeps factual roster independent from tactic assignment and blanks it outside the club', () => {
    expect(currentRosterLabel({ externalClub: false, factualSquadName: 'Under20', snapshotSquadName: 'Grupo 3', teamLevel: 'academy', primaryClubName: 'Fluminense' })).toBe('Under20')
    expect(currentRosterLabel({ externalClub: false, factualSquadName: null, snapshotSquadName: null, teamLevel: 'first_team', primaryClubName: 'Fluminense' })).toBe('Fluminense')
    expect(currentRosterLabel({ externalClub: false, factualSquadName: null, snapshotSquadName: null, teamLevel: 'academy', primaryClubName: 'Fluminense' })).toBe('Base')
    expect(currentRosterLabel({ externalClub: true, factualSquadName: 'Under20', snapshotSquadName: 'Under20', teamLevel: 'academy', primaryClubName: 'Fluminense' })).toBeNull()
  })

  it('maps planned market groups to the four canonical status labels', () => {
    expect(currentRosterStatus(false, null)).toBe('Nos planos')
    expect(currentRosterStatus(false, { id: 'loan', name: 'Empréstimo' })).toBe('Para empréstimo')
    expect(currentRosterStatus(false, { id: 'custom', name: 'Para venda' })).toBe('Para venda')
    expect(currentRosterStatus(true, { id: 'principal', name: 'Principal' })).toBe('Fora do clube')
  })

  it('chooses the tactical planning group from existing placement, factual roster or team level', () => {
    const groups = [{ id: 'principal', name: 'Principal' }, { id: 'u20', name: 'Under20' }, { id: 'loan', name: 'Empréstimo' }]
    expect(preferredTacticalPlanningGroupId(groups, 'principal', 'academy', 'Under20')).toBe('principal')
    expect(preferredTacticalPlanningGroupId(groups, null, 'academy', 'Under20')).toBe('u20')
    expect(preferredTacticalPlanningGroupId([{ id: 'principal', name: 'Principal' }, { id: 'base', name: 'Base' }], null, 'academy')).toBe('base')
  })
})

describe('countryFlagEmoji', () => {
  it('maps common current-roster nationalities and multi-nationality strings', () => {
    expect(countryFlagEmoji('Brasil')).toBe('🇧🇷')
    expect(countryFlagEmoji('Uruguay')).toBe('🇺🇾')
    expect(countryFlagEmoji('Argentina')).toBe('🇦🇷')
    expect(countryFlagEmoji('Colombia')).toBe('🇨🇴')
    expect(countryFlagEmoji('Brasil / Itália')).toBe('🇧🇷')
  })

  it('fails closed for an unknown country label', () => expect(countryFlagEmoji('País inventado')).toBeNull())
})

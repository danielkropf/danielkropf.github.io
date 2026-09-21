/** Local, read-only regression runner. Saves remain outside the repository.
 * Usage: node scripts/validate-league-save.mjs /absolute/path/to/save.fm
 */
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
const input = process.argv[2]
if (!input || !fs.statSync(input).isFile()) throw new Error('Provide a local .fm file path.')
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { readFmSaveBytes } = await server.ssrLoadModule('/src/lib/fm26-offline-normalizer.ts')
  const { leagueComparisons, isLeagueReference } = await server.ssrLoadModule('/src/lib/league-reference.ts')
  const started = performance.now()
  const result = await readFmSaveBytes(new Uint8Array(fs.readFileSync(input)), path.basename(input), (status, progress) => console.error(progress, status))
  const data = result.league_reference
  if (!isLeagueReference(data)) throw new Error(String(result.diagnostics.league_reference_warning ?? 'Invalid or absent reference payload'))
  console.log(JSON.stringify({ sourceSha256: data.sourceSha256, checkpoint: data.checkpoint, durationSeconds: (performance.now() - started) / 1000, trackedPlayers: result.players.length, rules: data.rules.length, confirmedCohorts: data.cohorts.filter(c=>c.status==='confirmed').length, observedPlayers: data.players.length, bytes: Buffer.byteLength(JSON.stringify(data)), diagnostics: data.diagnostics, teams: data.humanTeams.map(team=>({ ...team, comparisons: leagueComparisons(data,team.team).rows.map(row=>({direction:row.direction,uid:row.target,status:row.population.status,reason:row.population.reason,players:row.population.players.length,teams:row.population.teams,coveredTeams:row.population.coveredTeams})) })) }, null, 2))
} finally { await server.close() }

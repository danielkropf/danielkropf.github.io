import { describe, expect, it } from 'vitest'
import type { WorldCensusBatch, WorldCensusBatchDomain, WorldCoverageManifest } from './fm26-world-census'
import {
  canonicalBytes,
  sha256Canonical,
  WorldCensusProtocolEmitter,
  WorldCensusStreamConsumer,
  type WorldCensusStreamBatch,
  type WorldCensusStreamMessage,
  type WorldCensusStreamRunEnd,
} from './world-census-protocol'

type Case = { name: string; batches: WorldCensusBatch[] }

const manifest: WorldCoverageManifest = {
  version: 'world-coverage-manifest-v1',
  capabilities: [{
    capability_key: 'player_core', subject_unit: 'person_record',
    subject_scope: { id: 'confirmed_person_records', enumeration_status: 'complete_for_scope' },
    subjects_evaluated: 2, counts: { confirmed: 2, unknown: 0, ambiguous: 0, unsupported: 0, excluded: 0 },
    reason_counts: { confirmed: 2 }, coverage_ratio: 1,
  }],
}

function batch(domain: WorldCensusBatchDomain, items: unknown[], index = 0): WorldCensusBatch {
  return { domain, batch_index: index, items, serialized_bytes: canonicalBytes(items).byteLength }
}

function items(prefix: string, count: number, padding: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    eid: 1000 + index,
    uid: 2_000_000_000 + index,
    text: `${prefix}:${index}:ç:${'x'.repeat(padding + index % 31)}`,
    nested: { z: index % 7, a: [index, index + 1] },
  }))
}

const cases: Case[] = [
  { name: 'small', batches: [batch('person_records', items('s', 96, 220)), batch('biography_facts', items('sb', 64, 300), 1)] },
  { name: 'medium', batches: [batch('evidence_refs', items('e', 180, 180)), batch('person_records', items('m', 220, 330), 1), batch('player_core_facts', items('mc', 160, 420), 2)] },
  { name: 'large', batches: [batch('evidence_refs', items('le', 220, 240)), batch('derivation_refs', items('ld', 200, 260), 1), batch('person_records', items('l', 260, 480), 2), batch('contract_facts', items('lc', 190, 520), 3)] },
]

async function buildMessages(testCase: Case, budget: number, sourceChunks = testCase.batches): Promise<WorldCensusStreamMessage[]> {
  const messages: WorldCensusStreamMessage[] = []
  const emitter = new WorldCensusProtocolEmitter({
    runId: `${testCase.name}:run`,
    sourceArtifact: { sha256: 'a'.repeat(64), file_name: `${testCase.name}.fm`, byte_length: 123, internal_name: testCase.name },
    checkpoint: '2031-12-15',
    outputContractVersion: 'world-census-run-v1',
    representationVersion: 'world-census-representation-v1',
    readerVersion: 'wc-a-reader-v1',
    plannedCapabilities: ['player_core'],
    messageBudgetBytes: budget,
    send: async message => { messages.push(structuredClone(message)) },
  })
  await emitter.begin()
  for (const value of sourceChunks) await emitter.acceptBatch(value)
  await emitter.finish({ manifest, decoderCatalog: [{ decoder_id: 'synthetic', version: 'v1' }], diagnostics: { case: testCase.name } })
  return messages
}

async function consume(messages: WorldCensusStreamMessage[]) {
  const consumer = new WorldCensusStreamConsumer()
  const statuses: string[] = []
  for (const message of messages) statuses.push((await consumer.apply(message)).status)
  return { consumer, statuses }
}

function firstBatch(messages: WorldCensusStreamMessage[]): WorldCensusStreamBatch {
  const found = messages.find((message): message is WorldCensusStreamBatch => message.type.endsWith('_batch'))
  if (!found) throw new Error('batch missing')
  return found
}
function runEnd(messages: WorldCensusStreamMessage[]): WorldCensusStreamRunEnd {
  const found = messages.find((message): message is WorldCensusStreamRunEnd => message.type === 'run_end')
  if (!found) throw new Error('run_end missing')
  return found
}
function cloneMessages(messages: WorldCensusStreamMessage[]): WorldCensusStreamMessage[] { return structuredClone(messages) }

for (const testCase of cases) {
  describe(`R-WC-07 ${testCase.name}`, () => {
    for (const budget of [128 * 1024, 192 * 1024, 256 * 1024]) {
      it(`happy path ${budget / 1024}KiB`, async () => {
        const messages = await buildMessages(testCase, budget)
        const result = await consume(messages)
        expect(result.consumer.isComplete).toBe(true)
        expect(result.consumer.result?.logical_hash).toBe(runEnd(messages).logical_hash)
      })
    }

    it('keeps logical hash independent from WC-A source batch boundaries', async () => {
      const flat = testCase.batches.flatMap(value => value.items.map(item => ({ domain: value.domain, item })))
      const regrouped: WorldCensusBatch[] = []
      let index = 0
      for (const domain of [...new Set(flat.map(value => value.domain))]) {
        const domainItems = flat.filter(value => value.domain === domain).map(value => value.item)
        for (let offset = 0; offset < domainItems.length; offset += 17) regrouped.push(batch(domain, domainItems.slice(offset, offset + 17), index++))
      }
      const a = await buildMessages(testCase, 128 * 1024)
      const b = await buildMessages(testCase, 256 * 1024, regrouped)
      expect(runEnd(a).logical_hash).toBe(runEnd(b).logical_hash)
    })

    it('missing run_end remains incomplete', async () => {
      const messages = await buildMessages(testCase, 192 * 1024)
      const consumer = new WorldCensusStreamConsumer()
      for (const message of messages.filter(message => message.type !== 'run_end')) await consumer.apply(message)
      expect(consumer.isComplete).toBe(false)
    })

    it('identical replay is idempotent', async () => {
      const messages = await buildMessages(testCase, 192 * 1024)
      const consumer = new WorldCensusStreamConsumer()
      await consumer.apply(messages[0])
      const duplicate = firstBatch(messages)
      await consumer.apply(duplicate)
      const replay = await consumer.apply(structuredClone(duplicate))
      expect(replay.status).toBe('duplicate_idempotent')
      for (const message of messages.slice(messages.indexOf(duplicate) + 1)) await consumer.apply(message)
      expect(consumer.isComplete).toBe(true)
    })

    it('sequence gap rejects', async () => {
      const messages = await buildMessages(testCase, 192 * 1024)
      const consumer = new WorldCensusStreamConsumer()
      await consumer.apply(messages[0])
      await expect(consumer.apply(messages[2])).rejects.toThrow(/sequence_gap/)
    })

    it('same sequence with different content rejects', async () => {
      const messages = await buildMessages(testCase, 192 * 1024)
      const consumer = new WorldCensusStreamConsumer()
      await consumer.apply(messages[0])
      const original = firstBatch(messages)
      await consumer.apply(original)
      const changed = structuredClone(original)
      changed.item_count += 1
      await expect(consumer.apply(changed)).rejects.toThrow(/sequence_conflict/)
    })

    it('payload tampering rejects', async () => {
      const messages = cloneMessages(await buildMessages(testCase, 192 * 1024))
      const target = firstBatch(messages)
      ;(target.items[0] as Record<string, unknown>).tampered = true
      const consumer = new WorldCensusStreamConsumer()
      await consumer.apply(messages[0])
      await expect(consumer.apply(target)).rejects.toThrow(/batch_integrity_mismatch/)
    })

    it('item count mismatch rejects', async () => {
      const messages = cloneMessages(await buildMessages(testCase, 192 * 1024))
      const target = firstBatch(messages)
      target.item_count += 1
      const consumer = new WorldCensusStreamConsumer()
      await consumer.apply(messages[0])
      await expect(consumer.apply(target)).rejects.toThrow(/batch_item_count_mismatch/)
    })

    it('coverage tampering rejects', async () => {
      const messages = cloneMessages(await buildMessages(testCase, 192 * 1024))
      const coverage = messages.find(message => message.type === 'coverage_final')!
      if (coverage.type !== 'coverage_final') throw new Error('coverage missing')
      coverage.manifest.capabilities[0].subjects_evaluated += 1
      const consumer = new WorldCensusStreamConsumer()
      for (const message of messages) {
        if (message === coverage) { await expect(consumer.apply(message)).rejects.toThrow(/coverage_integrity_mismatch/); break }
        await consumer.apply(message)
      }
    })

    it('rejects a batch after coverage_final', async () => {
      const messages = cloneMessages(await buildMessages(testCase, 192 * 1024))
      const coverageIndex = messages.findIndex(message => message.type === 'coverage_final')
      const batchMessage = structuredClone(firstBatch(messages))
      batchMessage.seq = messages[coverageIndex].seq + 1
      const consumer = new WorldCensusStreamConsumer()
      for (const message of messages.slice(0, coverageIndex + 1)) await consumer.apply(message)
      await expect(consumer.apply(batchMessage)).rejects.toThrow(/batch_after_coverage_final/)
    })

    it('requires coverage_final to match the planned capability set', async () => {
      const messages = cloneMessages(await buildMessages(testCase, 192 * 1024))
      const coverage = messages.find(message => message.type === 'coverage_final')!
      if (coverage.type !== 'coverage_final') throw new Error('coverage missing')
      coverage.manifest.capabilities = []
      coverage.manifest_hash = await sha256Canonical(coverage.manifest)
      const consumer = new WorldCensusStreamConsumer()
      for (const message of messages) {
        if (message === coverage) { await expect(consumer.apply(message)).rejects.toThrow(/coverage_capability_mismatch/); break }
        await consumer.apply(message)
      }
    })

    it('run_end requires coverage_final', async () => {
      const messages = cloneMessages(await buildMessages(testCase, 192 * 1024))
      const coverageIndex = messages.findIndex(message => message.type === 'coverage_final')
      const end = messages.at(-1)!
      end.seq = messages[coverageIndex].seq
      const consumer = new WorldCensusStreamConsumer()
      for (const message of messages.slice(0, coverageIndex)) await consumer.apply(message)
      await expect(consumer.apply(end)).rejects.toThrow(/coverage_final_required/)
    })

    it('final count mismatch rejects', async () => {
      const messages = cloneMessages(await buildMessages(testCase, 192 * 1024))
      runEnd(messages).fact_count += 1
      const consumer = new WorldCensusStreamConsumer()
      for (const message of messages.slice(0, -1)) await consumer.apply(message)
      await expect(consumer.apply(messages.at(-1)!)).rejects.toThrow(/final_count_mismatch/)
    })

    it('final logical hash mismatch rejects', async () => {
      const messages = cloneMessages(await buildMessages(testCase, 192 * 1024))
      runEnd(messages).logical_hash = 'f'.repeat(64)
      const consumer = new WorldCensusStreamConsumer()
      for (const message of messages.slice(0, -1)) await consumer.apply(message)
      await expect(consumer.apply(messages.at(-1)!)).rejects.toThrow(/final_logical_hash_mismatch/)
    })
  })
}

for (const testCase of cases) {
  for (const budget of [128 * 1024, 256 * 1024]) {
    it(`exact complete-message budget ${testCase.name} ${budget / 1024}KiB`, async () => {
      const messages = await buildMessages(testCase, budget)
      const batches = messages.filter(message => message.type.endsWith('_batch'))
      expect(batches.length).toBeGreaterThan(0)
      expect(Math.max(...batches.map(message => canonicalBytes(message).byteLength))).toBeLessThanOrEqual(budget)
    })
  }
}

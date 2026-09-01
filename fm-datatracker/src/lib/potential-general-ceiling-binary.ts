/** Browser-safe inference for PlausibleCareerCeilingGeneralScore v2. */
export const POTENTIAL_GENERAL_CEILING_MAGIC = 'FMDTGC02'
export const POTENTIAL_GENERAL_CEILING_BINARY_VERSION = 2

export type GeneralCeilingNode = { left: number; right: number; feature: number; bitsetIndex: number; flags: number; threshold: number; value: number }
export type GeneralCeilingTree = { nodes: GeneralCeilingNode[]; categoricalBitsets: Uint32Array[] }
export type GeneralCeilingEnsemble = { featureCount: number; baseline: number; trees: GeneralCeilingTree[] }
export type GeneralCeilingBinaryModel = { profile: GeneralCeilingEnsemble; coarse: GeneralCeilingEnsemble; basePositionGroupCount: number }

const HEADER_BYTES = 56
const TREE_HEADER_BYTES = 8
const NODE_BYTES = 40
const CAT_WORDS = 8
const decoder = new TextDecoder('ascii')

function assertRange(total: number, offset: number, length: number, label: string) {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > total) throw new Error(`PotentialGeneral asset truncado em ${label}.`)
}

function readEnsemble(bytes: Uint8Array, view: DataView, start: number, treeCount: number, featureCount: number, baseline: number, label: string) {
  let offset = start
  const trees: GeneralCeilingTree[] = []
  for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
    assertRange(bytes.byteLength, offset, TREE_HEADER_BYTES, `${label} tree ${treeIndex} header`)
    const nodeCount = view.getUint32(offset, true)
    const bitsetCount = view.getUint32(offset + 4, true)
    if (!nodeCount) throw new Error(`PotentialGeneral asset inválido: ${label} tree ${treeIndex} vazia.`)
    offset += TREE_HEADER_BYTES
    assertRange(bytes.byteLength, offset, nodeCount * NODE_BYTES, `${label} tree ${treeIndex} nodes`)
    const nodes: GeneralCeilingNode[] = []
    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
      const at = offset + nodeIndex * NODE_BYTES
      const node = { left: view.getInt32(at, true), right: view.getInt32(at + 4, true), feature: view.getInt32(at + 8, true), bitsetIndex: view.getInt32(at + 12, true), flags: view.getUint32(at + 16, true), threshold: view.getFloat64(at + 24, true), value: view.getFloat64(at + 32, true) }
      const leaf = Boolean(node.flags & 1)
      const categorical = Boolean(node.flags & 4)
      if (!leaf && (node.left < 0 || node.left >= nodeCount || node.right < 0 || node.right >= nodeCount || node.feature < 0 || node.feature >= featureCount)) throw new Error(`PotentialGeneral asset inválido: ${label} node ${nodeIndex} fora do contrato.`)
      if (categorical && (node.bitsetIndex < 0 || node.bitsetIndex >= bitsetCount)) throw new Error(`PotentialGeneral asset inválido: bitset fora da faixa em ${label} tree ${treeIndex}.`)
      if (!Number.isFinite(node.threshold) || !Number.isFinite(node.value)) throw new Error(`PotentialGeneral asset inválido: valor não-finito em ${label} tree ${treeIndex}.`)
      nodes.push(node)
    }
    offset += nodeCount * NODE_BYTES
    assertRange(bytes.byteLength, offset, bitsetCount * CAT_WORDS * 4, `${label} tree ${treeIndex} bitsets`)
    const categoricalBitsets: Uint32Array[] = []
    for (let bitsetIndex = 0; bitsetIndex < bitsetCount; bitsetIndex += 1) {
      const words = new Uint32Array(CAT_WORDS)
      for (let word = 0; word < CAT_WORDS; word += 1) words[word] = view.getUint32(offset + (bitsetIndex * CAT_WORDS + word) * 4, true)
      categoricalBitsets.push(words)
    }
    offset += bitsetCount * CAT_WORDS * 4
    trees.push({ nodes, categoricalBitsets })
  }
  return { ensemble: { featureCount, baseline, trees }, offset }
}

export function parsePotentialGeneralCeilingModel(buffer: ArrayBuffer | Uint8Array): GeneralCeilingBinaryModel {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  assertRange(bytes.byteLength, 0, HEADER_BYTES, 'header')
  if (decoder.decode(bytes.subarray(0, 8)) !== POTENTIAL_GENERAL_CEILING_MAGIC) throw new Error('PotentialGeneral asset magic inválido.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(8, true)
  const profileFeatureCount = view.getUint32(12, true)
  const profileTreeCount = view.getUint32(16, true)
  const coarseFeatureCount = view.getUint32(20, true)
  const coarseTreeCount = view.getUint32(24, true)
  const basePositionGroupCount = view.getUint32(28, true)
  const profileBaseline = view.getFloat64(40, true)
  const coarseBaseline = view.getFloat64(48, true)
  if (version !== POTENTIAL_GENERAL_CEILING_BINARY_VERSION || profileFeatureCount !== 62 || profileTreeCount !== 180 || coarseFeatureCount !== 15 || coarseTreeCount !== 180 || basePositionGroupCount !== 10 || !Number.isFinite(profileBaseline) || !Number.isFinite(coarseBaseline)) throw new Error('PotentialGeneral asset metadata divergente do v2 validado.')
  const profileRead = readEnsemble(bytes, view, HEADER_BYTES, profileTreeCount, profileFeatureCount, profileBaseline, 'profile')
  const coarseRead = readEnsemble(bytes, view, profileRead.offset, coarseTreeCount, coarseFeatureCount, coarseBaseline, 'coarse')
  if (coarseRead.offset !== bytes.byteLength) throw new Error('PotentialGeneral asset possui bytes residuais inesperados.')
  return { profile: profileRead.ensemble, coarse: coarseRead.ensemble, basePositionGroupCount }
}

function categoricalLeft(words: Uint32Array, category: number) {
  if (!Number.isInteger(category) || category < 0 || category >= CAT_WORDS * 32) return false
  return Boolean((words[category >>> 5] >>> (category & 31)) & 1)
}

function predictTree(tree: GeneralCeilingTree, features: readonly number[]) {
  let index = 0
  for (let guard = 0; guard <= tree.nodes.length; guard += 1) {
    const node = tree.nodes[index]
    if (!node) throw new Error('PotentialGeneral asset inválido: travessia fora da árvore.')
    if (node.flags & 1) return node.value
    const value = features[node.feature]
    const left = Number.isNaN(value) ? Boolean(node.flags & 2) : node.flags & 4 ? categoricalLeft(tree.categoricalBitsets[node.bitsetIndex], value) : value <= node.threshold
    index = left ? node.left : node.right
  }
  throw new Error('PotentialGeneral asset inválido: ciclo na árvore.')
}

function predictEnsemble(ensemble: GeneralCeilingEnsemble, features: readonly number[]) {
  if (features.length !== ensemble.featureCount || features.some(value => !Number.isFinite(value))) throw new Error('PotentialGeneral feature vector inválido.')
  let output = ensemble.baseline
  for (const tree of ensemble.trees) output += predictTree(tree, features)
  if (!Number.isFinite(output)) throw new Error('PotentialGeneral produziu predição não-finita.')
  return output
}

export function predictPotentialGeneralCeiling(model: GeneralCeilingBinaryModel, features: readonly number[]) {
  return predictEnsemble(model.profile, features)
}

export function predictPotentialGeneralCoarseCeiling(model: GeneralCeilingBinaryModel, features: readonly number[]) {
  return predictEnsemble(model.coarse, features.slice(0, model.coarse.featureCount))
}

/**
 * The coarse model is a protective floor, so PA/headroom must never lower it.
 * Evaluate its fixed 10-CA grid cumulatively; CA and PA are integer FM facts,
 * making this deterministic step envelope monotonic across every valid input.
 */
export function predictPotentialGeneralCoarseCeilingMonotonic(model: GeneralCeilingBinaryModel, features: readonly number[]) {
  if (features.length < model.coarse.featureCount || !Number.isFinite(features[3])) throw new Error('PotentialGeneral coarse feature vector inválido.')
  const headroom = Math.max(0, Math.min(200, Math.floor(features[3])))
  const candidate = features.slice(0, model.coarse.featureCount)
  let output = -Infinity
  for (let bucket = 0; bucket <= headroom; bucket += 10) {
    candidate[3] = bucket
    output = Math.max(output, predictEnsemble(model.coarse, candidate))
  }
  if (!Number.isFinite(output)) throw new Error('PotentialGeneral coarse floor monotônico inválido.')
  return output
}

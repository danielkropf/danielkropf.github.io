/** Browser-safe inference for the validated PlausibleCareerCeilingRoleScore v1.1. */
export const POTENTIAL_ROLE_CEILING_MAGIC = 'FMDTPH21'
export const POTENTIAL_ROLE_CEILING_BINARY_VERSION = 2

export type PotentialCeilingNode = {
  left: number
  right: number
  feature: number
  bitsetIndex: number
  flags: number
  threshold: number
  value: number
}
export type PotentialCeilingTree = { nodes: PotentialCeilingNode[]; categoricalBitsets: Uint32Array[] }
export type PotentialCeilingEnsemble = { featureCount: number; baseline: number; trees: PotentialCeilingTree[] }
export type PotentialCeilingBinaryModel = { phase: PotentialCeilingEnsemble; individualRoleCount: number }

const HEADER_BYTES = 32
const TREE_HEADER_BYTES = 8
const NODE_BYTES = 40
const CAT_WORDS = 8
const decoder = new TextDecoder('ascii')
const finite = (value: number) => Number.isFinite(value)

function range(total: number, offset: number, length: number, label: string) {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > total) {
    throw new Error(`PotentialRole asset truncado em ${label}.`)
  }
}

function readEnsemble(bytes: Uint8Array, view: DataView, start: number, treeCount: number, featureCount: number, baseline: number) {
  let offset = start
  const trees: PotentialCeilingTree[] = []
  for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
    range(bytes.byteLength, offset, TREE_HEADER_BYTES, `tree ${treeIndex} header`)
    const nodeCount = view.getUint32(offset, true)
    const bitsetCount = view.getUint32(offset + 4, true)
    if (!nodeCount) throw new Error(`PotentialRole asset inválido: tree ${treeIndex} vazia.`)
    offset += TREE_HEADER_BYTES
    range(bytes.byteLength, offset, nodeCount * NODE_BYTES, `tree ${treeIndex} nodes`)
    const nodes: PotentialCeilingNode[] = []
    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
      const at = offset + nodeIndex * NODE_BYTES
      const node = {
        left: view.getInt32(at, true),
        right: view.getInt32(at + 4, true),
        feature: view.getInt32(at + 8, true),
        bitsetIndex: view.getInt32(at + 12, true),
        flags: view.getUint32(at + 16, true),
        threshold: view.getFloat64(at + 24, true),
        value: view.getFloat64(at + 32, true),
      }
      const leaf = Boolean(node.flags & 1)
      const categorical = Boolean(node.flags & 4)
      if (!leaf && (node.left < 0 || node.left >= nodeCount || node.right < 0 || node.right >= nodeCount)) throw new Error(`PotentialRole asset inválido: child fora da faixa em tree ${treeIndex}.`)
      if (!leaf && (node.feature < 0 || node.feature >= featureCount)) throw new Error(`PotentialRole asset inválido: feature fora da faixa em tree ${treeIndex}.`)
      if (categorical && (node.bitsetIndex < 0 || node.bitsetIndex >= bitsetCount)) throw new Error(`PotentialRole asset inválido: bitset fora da faixa em tree ${treeIndex}.`)
      if (!finite(node.threshold) || !finite(node.value)) throw new Error(`PotentialRole asset inválido: valor não-finito em tree ${treeIndex}.`)
      nodes.push(node)
    }
    offset += nodeCount * NODE_BYTES
    const categoricalBitsets: Uint32Array[] = []
    range(bytes.byteLength, offset, bitsetCount * CAT_WORDS * 4, `tree ${treeIndex} categorical bitsets`)
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

export function parsePotentialRoleCeilingModel(buffer: ArrayBuffer | Uint8Array): PotentialCeilingBinaryModel {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  range(bytes.byteLength, 0, HEADER_BYTES, 'header')
  if (decoder.decode(bytes.subarray(0, 8)) !== POTENTIAL_ROLE_CEILING_MAGIC) throw new Error('PotentialRole asset magic inválido.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(8, true)
  const featureCount = view.getUint32(12, true)
  const treeCount = view.getUint32(16, true)
  const individualRoleCount = view.getUint32(20, true)
  const baseline = view.getFloat64(24, true)
  if (version !== POTENTIAL_ROLE_CEILING_BINARY_VERSION) throw new Error(`PotentialRole asset versão inválida: ${version}.`)
  if (featureCount !== 51 || treeCount !== 180 || individualRoleCount !== 83) throw new Error('PotentialRole asset metadata binária divergente do v1.1 validado.')
  if (!finite(baseline)) throw new Error('PotentialRole asset baseline inválida.')
  const phaseRead = readEnsemble(bytes, view, HEADER_BYTES, treeCount, featureCount, baseline)
  if (phaseRead.offset !== bytes.byteLength) throw new Error('PotentialRole asset possui bytes residuais inesperados.')
  return { phase: phaseRead.ensemble, individualRoleCount }
}

function categoricalLeft(words: Uint32Array, category: number) {
  if (!Number.isInteger(category) || category < 0 || category >= CAT_WORDS * 32) return false
  return Boolean((words[category >>> 5] >>> (category & 31)) & 1)
}

function predictTree(tree: PotentialCeilingTree, features: readonly number[]) {
  let index = 0
  for (let guard = 0; guard <= tree.nodes.length; guard += 1) {
    const node = tree.nodes[index]
    if (!node) throw new Error('PotentialRole asset inválido: travessia fora da árvore.')
    if (node.flags & 1) return node.value
    const value = features[node.feature]
    let left: boolean
    if (Number.isNaN(value)) left = Boolean(node.flags & 2)
    else if (node.flags & 4) left = categoricalLeft(tree.categoricalBitsets[node.bitsetIndex], value)
    else left = value <= node.threshold
    index = left ? node.left : node.right
  }
  throw new Error('PotentialRole asset inválido: ciclo na árvore.')
}

export function predictPotentialCeilingEnsemble(ensemble: PotentialCeilingEnsemble, features: readonly number[]) {
  if (features.length !== ensemble.featureCount || features.some(value => !Number.isFinite(value))) throw new Error('PotentialRole feature vector inválido.')
  let value = ensemble.baseline
  for (const tree of ensemble.trees) value += predictTree(tree, features)
  if (!Number.isFinite(value)) throw new Error('PotentialRole produziu predição não-finita.')
  return value
}

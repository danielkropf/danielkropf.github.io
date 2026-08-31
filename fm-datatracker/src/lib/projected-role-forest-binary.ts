/**
 * Browser-safe, dependency-free ExtraTrees inference format for ProjectedRoleScore.
 *
 * Binary layout (little-endian):
 *   0..7   ASCII `FMDTPRF1`
 *   8      u32 tree_count
 *   12     u32 output_count
 *   16     u32 feature_count
 *   20     u32 leaf_codec (0=Float64 means, 1=uint16 count + int16 sums, 2=uint16 count + int32 sums)
 *   then repeated tree_count times:
 *     u32 node_count
 *     u32 leaf_count
 *     node_count * {
 *       i32 left_child
 *       i32 right_child
 *       i32 feature_index
 *       i32 leaf_index       // >=0 only for leaves
 *       f64 threshold        // ignored for leaves
 *     }
 *     leaf payload, selected once per forest by leaf_codec:
 *       0 = leaf_count * output_count * f64 means
 *       1 = per leaf: u16 sample_count + output_count * i16 target_sum
 *       2 = per leaf: u16 sample_count + output_count * i32 target_sum
 *
 * Thresholds are always Float64. Integer leaf codecs are lossless: the exporter
 * enables them only when every sklearn leaf mean can be reconstructed exactly as
 * integer target_sum / sample_count; otherwise codec 0 stores Float64 means.
 */

export const PROJECTED_ROLE_FOREST_MAGIC = 'FMDTPRF1'
export const PROJECTED_ROLE_FOREST_BINARY_VERSION = 1

export type ProjectedRoleForestNode = {
  left: number
  right: number
  feature: number
  leafIndex: number
  threshold: number
}

export type ProjectedRoleForestTree = {
  nodes: ProjectedRoleForestNode[]
  leafValues: Float64Array
}

export type ProjectedRoleForest = {
  treeCount: number
  outputCount: number
  featureCount: number
  leafCodec: 0 | 1 | 2
  trees: ProjectedRoleForestTree[]
}

const HEADER_BYTES = 24
const TREE_HEADER_BYTES = 8
const NODE_BYTES = 24
const decoder = new TextDecoder('ascii')

function assertRange(total: number, offset: number, length: number, label: string) {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > total) {
    throw new Error(`ProjectedRole forest truncado em ${label}.`)
  }
}

function positiveInt(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`ProjectedRole forest inválido: ${label}.`)
  return value
}

export function parseProjectedRoleForest(buffer: ArrayBuffer | Uint8Array): ProjectedRoleForest {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  assertRange(bytes.byteLength, 0, HEADER_BYTES, 'header')
  const magic = decoder.decode(bytes.subarray(0, 8))
  if (magic !== PROJECTED_ROLE_FOREST_MAGIC) throw new Error(`ProjectedRole forest magic inválido: ${magic}.`)

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const treeCount = positiveInt(view.getUint32(8, true), 'treeCount')
  const outputCount = positiveInt(view.getUint32(12, true), 'outputCount')
  const featureCount = positiveInt(view.getUint32(16, true), 'featureCount')
  const leafCodec = view.getUint32(20, true)
  if (leafCodec !== 0 && leafCodec !== 1 && leafCodec !== 2) throw new Error(`ProjectedRole forest inválido: leafCodec ${leafCodec}.`)

  let offset = HEADER_BYTES
  const trees: ProjectedRoleForestTree[] = []
  for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
    assertRange(bytes.byteLength, offset, TREE_HEADER_BYTES, `tree ${treeIndex} header`)
    const nodeCount = positiveInt(view.getUint32(offset, true), `tree ${treeIndex} nodeCount`)
    const leafCount = positiveInt(view.getUint32(offset + 4, true), `tree ${treeIndex} leafCount`)
    offset += TREE_HEADER_BYTES

    const nodesBytes = nodeCount * NODE_BYTES
    assertRange(bytes.byteLength, offset, nodesBytes, `tree ${treeIndex} nodes`)
    const nodes: ProjectedRoleForestNode[] = []
    let observedLeaves = 0
    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
      const nodeOffset = offset + nodeIndex * NODE_BYTES
      const left = view.getInt32(nodeOffset, true)
      const right = view.getInt32(nodeOffset + 4, true)
      const feature = view.getInt32(nodeOffset + 8, true)
      const leafIndex = view.getInt32(nodeOffset + 12, true)
      const threshold = view.getFloat64(nodeOffset + 16, true)
      const leaf = leafIndex >= 0
      if (leaf) {
        if (leafIndex >= leafCount) throw new Error(`ProjectedRole forest inválido: leafIndex fora da faixa em tree ${treeIndex}.`)
        observedLeaves += 1
      } else {
        if (feature < 0 || feature >= featureCount) throw new Error(`ProjectedRole forest inválido: feature fora da faixa em tree ${treeIndex}.`)
        if (left < 0 || left >= nodeCount || right < 0 || right >= nodeCount) throw new Error(`ProjectedRole forest inválido: child fora da faixa em tree ${treeIndex}.`)
        if (!Number.isFinite(threshold)) throw new Error(`ProjectedRole forest inválido: threshold não-finito em tree ${treeIndex}.`)
      }
      nodes.push({ left, right, feature, leafIndex, threshold })
    }
    if (observedLeaves !== leafCount) throw new Error(`ProjectedRole forest inválido: leafCount divergente em tree ${treeIndex}.`)
    offset += nodesBytes

    const valueCount = leafCount * outputCount
    const leafValues = new Float64Array(valueCount)
    if (leafCodec === 0) {
      const valuesBytes = valueCount * Float64Array.BYTES_PER_ELEMENT
      assertRange(bytes.byteLength, offset, valuesBytes, `tree ${treeIndex} leafValues`)
      for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
        const value = view.getFloat64(offset + valueIndex * 8, true)
        if (!Number.isFinite(value)) throw new Error(`ProjectedRole forest inválido: leaf value não-finito em tree ${treeIndex}.`)
        leafValues[valueIndex] = value
      }
      offset += valuesBytes
    } else {
      const sumBytes = leafCodec === 1 ? 2 : 4
      const bytesPerLeaf = 2 + outputCount * sumBytes
      assertRange(bytes.byteLength, offset, leafCount * bytesPerLeaf, `tree ${treeIndex} integer leafValues`)
      for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
        const leafOffset = offset + leafIndex * bytesPerLeaf
        const sampleCount = view.getUint16(leafOffset, true)
        if (sampleCount <= 0) throw new Error(`ProjectedRole forest inválido: sampleCount zero em tree ${treeIndex}.`)
        for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
          const sumOffset = leafOffset + 2 + outputIndex * sumBytes
          const sum = leafCodec === 1 ? view.getInt16(sumOffset, true) : view.getInt32(sumOffset, true)
          leafValues[leafIndex * outputCount + outputIndex] = sum / sampleCount
        }
      }
      offset += leafCount * bytesPerLeaf
    }
    trees.push({ nodes, leafValues })
  }

  if (offset !== bytes.byteLength) throw new Error(`ProjectedRole forest inválido: ${bytes.byteLength - offset} bytes extras.`)
  return { treeCount, outputCount, featureCount, leafCodec: leafCodec as 0 | 1 | 2, trees }
}

export function predictProjectedRoleForest(forest: ProjectedRoleForest, features: ArrayLike<number>): Float64Array {
  if (features.length !== forest.featureCount) {
    throw new Error(`ProjectedRole feature vector inválido: esperado ${forest.featureCount}, recebido ${features.length}.`)
  }
  for (let index = 0; index < features.length; index += 1) {
    if (!Number.isFinite(features[index])) throw new Error(`ProjectedRole feature ${index} não-finita.`)
  }

  const out = new Float64Array(forest.outputCount)
  for (const tree of forest.trees) {
    let nodeIndex = 0
    let guard = 0
    while (true) {
      if (guard++ > tree.nodes.length) throw new Error('ProjectedRole forest inválido: ciclo na árvore.')
      const node = tree.nodes[nodeIndex]
      if (!node) throw new Error('ProjectedRole forest inválido: node inexistente.')
      if (node.leafIndex >= 0) {
        const base = node.leafIndex * forest.outputCount
        for (let outputIndex = 0; outputIndex < forest.outputCount; outputIndex += 1) {
          out[outputIndex] += tree.leafValues[base + outputIndex]
        }
        break
      }
      nodeIndex = features[node.feature] <= node.threshold ? node.left : node.right
    }
  }
  for (let outputIndex = 0; outputIndex < forest.outputCount; outputIndex += 1) out[outputIndex] /= forest.treeCount
  return out
}

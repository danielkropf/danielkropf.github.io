export type OracleTacticProperty = {
  propertyName?: string | null
  propertyId?: number | null
  resolvedValue?: string | null
  error?: string | null
}

type OracleDynamicProperty = { propertyName?: string | null; resolvedValue?: string | null }
type OracleTacticCollectionItem = { index?: number | null; dynamicReference?: { properties?: OracleDynamicProperty[] | null } | null }

export type OracleTacticBatch = {
  oracleVersion?: string | null
  sourceType?: string | null
  batchId?: string | null
  results: Array<OracleTacticProperty & { collection?: { items?: OracleTacticCollectionItem[] | null } | null }>
}

export type RawTacticAssignment = {
  playerIndex: number
  teamSelectionIndex: number | null
  position: number | null
  role: number | null
  verticalShift: number | null
  horizontalShift: number | null
  isGoalkeeper: boolean | null
}

export type NormalizedOracleTactic = {
  source: 'fm26-oracle'
  oracleVersion: string | null
  batchId: string | null
  name: string | null
  mentality: string | null
  activeSlot: number | null
  tacticalIntensity: number | null
  tacticalStyle: number | null
  instructions: {
    tempo: { status: 'confirmed' | 'unavailable'; rawValue: string | null; value: 'lower' | 'standard' | 'much_lower' | null }
  }
  ip: { status: 'raw_confirmed' | 'unsupported'; reason: string; assignments: RawTacticAssignment[] }
  oop: { status: 'raw_confirmed' | 'unsupported'; reason: string; assignments: RawTacticAssignment[] }
  raw_data: OracleTacticBatch
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Oracle JSON inválido: ${label} deve ser um objeto.`)
  return value as Record<string, unknown>
}
const optionalObject = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const nullableString = (value: unknown) => value === null || value === undefined ? null : typeof value === 'string' ? value : String(value)
const numeric = (value: string | null) => value !== null && /^-?\d+(?:[.,]\d+)?$/.test(value) ? Number(value.replace(',', '.')) : null
const boolean = (value: string | null) => value === 'True' ? true : value === 'False' ? false : null

const rawAssignments = (result: OracleTacticBatch['results'][number] | undefined, prefix: 'IP' | 'OOP'): RawTacticAssignment[] => {
  const items = result?.collection?.items
  if (!items) return []
  return items.flatMap(item => {
    const values = new Map((item.dynamicReference?.properties ?? []).map(property => [property.propertyName ?? '', property.resolvedValue ?? null]))
    const playerIndex = numeric(values.get('PlayerIndex') ?? null)
    if (playerIndex === null || !Number.isInteger(playerIndex)) return []
    return [{
      playerIndex,
      teamSelectionIndex: numeric(values.get('TeamSelectionIndex') ?? null),
      position: numeric(values.get(`${prefix}Position`) ?? null),
      role: numeric(values.get(`${prefix}Role`) ?? null),
      verticalShift: numeric(values.get('TacticalPositionShiftVertical') ?? null),
      horizontalShift: numeric(values.get('TacticalPositionShiftHorizontal') ?? null),
      isGoalkeeper: boolean(values.get('IsGoalkeeper') ?? null),
    }]
  })
}

/** Parses a channel_batch emitted for FM.UI.TeamTacticReference without assigning meanings to unknown instruction keys. */
export function parseOracleTacticJson(text: string): OracleTacticBatch {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Oracle JSON inválido: o arquivo não contém JSON válido.') }
  const batch = object(raw, 'resultado')
  const sourceType = nullableString(batch.SourceType ?? batch.sourceType)
  if (sourceType !== 'FM.UI.TeamTacticReference') throw new Error(`Oracle JSON incompatível: esperada TeamTacticReference, recebida ${sourceType ?? 'ausente'}.`)
  const rawResults = batch.Results ?? batch.results
  if (!Array.isArray(rawResults)) throw new Error('Oracle JSON inválido: Results não foi encontrado.')
  return {
    oracleVersion: nullableString(batch.OracleVersion ?? batch.oracleVersion),
    sourceType,
    batchId: nullableString(batch.BatchId ?? batch.batchId),
    results: rawResults.map((rawProperty, index) => {
      const property = object(rawProperty, `Results[${index}]`)
      return {
        propertyName: nullableString(property.PropertyName ?? property.propertyName),
        propertyId: typeof (property.PropertyId ?? property.propertyId) === 'number' ? Number(property.PropertyId ?? property.propertyId) : null,
        resolvedValue: nullableString(property.ResolvedValue ?? property.resolvedValue),
        error: nullableString(property.Error ?? property.error),
        collection: (() => {
          const rawCollection = property.Collection ?? property.collection
          if (!rawCollection || typeof rawCollection !== 'object' || Array.isArray(rawCollection)) return null
          const collection = rawCollection as Record<string, unknown>
          const rawItems = collection.Items ?? collection.items
          if (!Array.isArray(rawItems)) return { items: [] }
          return { items: rawItems.map(rawItem => {
            const item = object(rawItem, `Results[${index}].Collection item`)
            const dynamicReference = optionalObject(item.DynamicReference ?? item.dynamicReference)
            const rawProperties = dynamicReference?.Properties ?? dynamicReference?.properties
            return {
              index: typeof (item.Index ?? item.index) === 'number' ? Number(item.Index ?? item.index) : null,
              dynamicReference: dynamicReference ? { properties: Array.isArray(rawProperties) ? rawProperties.map(rawDynamicProperty => {
                const dynamicProperty = object(rawDynamicProperty, 'DynamicReference property')
                return { propertyName: nullableString(dynamicProperty.PropertyName ?? dynamicProperty.propertyName), resolvedValue: nullableString(dynamicProperty.ResolvedValue ?? dynamicProperty.resolvedValue) }
              }) : [] } : null,
            }
          }) }
        })(),
      }
    }),
  }
}

export function normalizeOracleTactic(batch: OracleTacticBatch): NormalizedOracleTactic {
  const values = new Map(batch.results.filter(result => !result.error && result.propertyName).map(result => [result.propertyName as string, result.resolvedValue ?? null]))
  const tempoRaw = values.get('Tempo') ?? null
  const tempo = tempoRaw === '1311996258' ? 'lower' : tempoRaw === '1496610426' ? 'standard' : tempoRaw === '1498756423' ? 'much_lower' : null
  const formation = batch.results.find(result => result.propertyName === 'TacticalPositionsCombined' && !result.error)
  const ipAssignments = rawAssignments(formation, 'IP')
  const oopAssignments = rawAssignments(formation, 'OOP')
  const hasRawFormation = ipAssignments.length > 0 && ipAssignments.length === oopAssignments.length
  const unsupported = 'IP/OOP semantics require controlled-change evidence for formation position and role enum labels.'
  const rawConfirmed = 'Player linkage and IP/OOP position/role keys were read from TacticalPositionsCombined. Numeric enum labels remain intentionally unmapped until controlled-change evidence exists.'
  return {
    source: 'fm26-oracle', oracleVersion: batch.oracleVersion ?? null, batchId: batch.batchId ?? null,
    name: values.get('Name') ?? null, mentality: values.get('MentalityString') ?? null,
    activeSlot: numeric(values.get('CurrentTacticSlot') ?? null), tacticalIntensity: numeric(values.get('TacticalIntensity') ?? null), tacticalStyle: numeric(values.get('TacticalStyle') ?? null),
    instructions: { tempo: { status: tempo ? 'confirmed' : 'unavailable', rawValue: tempoRaw, value: tempo } },
    ip: { status: hasRawFormation ? 'raw_confirmed' : 'unsupported', reason: hasRawFormation ? rawConfirmed : unsupported, assignments: ipAssignments },
    oop: { status: hasRawFormation ? 'raw_confirmed' : 'unsupported', reason: hasRawFormation ? rawConfirmed : unsupported, assignments: oopAssignments }, raw_data: batch,
  }
}

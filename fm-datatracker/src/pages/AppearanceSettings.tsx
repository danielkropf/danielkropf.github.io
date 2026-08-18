import { useEffect, useState } from 'react'
import { applyAppearance, DEFAULT_APPEARANCE, loadAppearance, saveAppearance, type Appearance } from '../features/appearance/preferences'

export function AppearanceSettings() {
  const [value, setValue] = useState(loadAppearance)
  useEffect(() => applyAppearance(value), [value])
  function change(key: keyof Appearance, color: string) { const next = { ...value, [key]: color }; setValue(next); saveAppearance(next) }
  function restore() { setValue(DEFAULT_APPEARANCE); applyAppearance(DEFAULT_APPEARANCE); saveAppearance(DEFAULT_APPEARANCE) }
  return <div><div className="title-row"><div><span className="eyebrow">INTERFACE</span><h2>Cores e identificação visual</h2><p>Personalize as faixas de notas, atributos e as cores das linhas posicionais.</p></div></div><div className="appearance-grid"><ColorGroup title="Notas" entries={[["scoreHigh", "Alta"], ["scoreMid", "Média"], ["scoreLow", "Baixa"]]} value={value} change={change} /><ColorGroup title="Atributos" entries={[["attributeHigh", "Alto (15–20)"], ["attributeMid", "Médio (10–14)"], ["attributeLow", "Baixo (1–9)"]]} value={value} change={change} /><ColorGroup title="Posições" entries={[["gk", "Goleiro"], ["d", "Defesa"], ["dm", "Volante"], ["m", "Meio-campo"], ["am", "Meia atacante"], ["st", "Atacante"]]} value={value} change={change} /></div><div className="appearance-actions"><button className="ghost" onClick={restore}>Restaurar cores padrão</button></div></div>
}

function ColorGroup({ title, entries, value, change }: { title: string; entries: [keyof Appearance, string][]; value: Appearance; change: (key: keyof Appearance, color: string) => void }) {
  return <section className="card appearance-group"><h3>{title}</h3><div className="appearance-colors">{entries.map(([key, label]) => <label key={key}>{label}<input type="color" value={value[key]} onChange={event => change(key, event.target.value)} /></label>)}</div></section>
}

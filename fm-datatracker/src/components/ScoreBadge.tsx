type Props={value:number|null;rank?:number|null;className?:string;showTitle?:boolean}

export function ScoreBadge({value,rank=null,className='',showTitle=true}:Props){
  const marker=value===null?null:Math.max(0,Math.min(100,((value-7)/8)*100))
  const level=marker===null?'score-none':marker>=75?'score-high':marker>=25?'score-mid':'score-low'
  const display=value===null?'—':value.toLocaleString('pt-BR',{maximumFractionDigits:2})
  const title=rank===null?'Nota na escala FM de 1 a 20':`Nota na escala FM de 1 a 20 · Percentil ${rank} entre jogadores aptos da base de referência`
  return <span className={`overall-score ${level} ${className}`.trim()} title={showTitle?title:undefined}><span className="score-meter" style={{width:`${marker??0}%`}}/><b>{display}</b></span>
}

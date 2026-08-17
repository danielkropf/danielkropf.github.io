import{mkdir,readFile,writeFile}from'node:fs/promises'
import{basename,resolve}from'node:path'

const attributes=[
  ['corners','Corners'],['crossing','Crossing'],['dribbling','Dribbling'],['finishing','Finishing'],['first_touch','First Touch'],['free_kick_taking','Free Kick Taking'],['heading','Heading'],['long_shots','Long Shots'],['long_throws','Long Throws'],['marking','Marking'],['passing','Passing'],['penalty_taking','Penalty Taking'],['tackling','Tackling'],['technique','Technique'],
  ['aggression','Aggression'],['anticipation','Anticipation'],['bravery','Bravery'],['composure','Composure'],['concentration','Concentration'],['decisions','Decisions'],['determination','Determination'],['flair','Flair'],['leadership','Leadership'],['off_the_ball','Off The Ball'],['positioning','Positioning'],['team_work','Team Work'],['vision','Vision'],['work_rate','Work Rate'],
  ['acceleration','Acceleration'],['agility','Agility'],['balance','Balance'],['jumping_reach','Jumping Reach'],['natural_fitness','Natural Fitness'],['pace','Pace'],['stamina','Stamina'],['strength','Strength'],
  ['aerial_reach','Aerial Reach'],['command_of_area','Command Of Area'],['communication','Communication'],['eccentricity','Eccentricity'],['handling','Handling'],['kicking','Kicking'],['one_on_ones','One On Ones'],['punching','Punching'],['reflexes','Reflexes'],['rushing_out_tendency','Rushing Out (Tendency)'],['throwing','Throwing']
]

const inputs=process.argv.slice(2)
if(!inputs.length)throw new Error('Informe um ou mais arquivos "País N Players.csv".')
const players=[]
for(const input of inputs){
  const match=basename(input).match(/^(.+)\s+(\d+)\s+Players\.csv$/i)
  if(!match)throw new Error(`Nome fora do padrão: ${basename(input)}`)
  const text=await readFile(input,'utf8'),lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean)
  const headers=lines.shift().split(';'),index=Object.fromEntries(headers.map((header,i)=>[header,i]))
  for(const[,label]of attributes)if(index[label]===undefined)throw new Error(`${basename(input)} não contém ${label}`)
  for(const line of lines){
    const cells=line.split(';')
    players.push({c:match[1],d:Number(match[2]),a:Number(cells[index.Age])||null,p:cells[index.Position]||'',v:attributes.map(([,label])=>Number(cells[index[label]])||null)})
  }
}
const markets=Object.values(Object.fromEntries(players.map(({c,d})=>[`${c}:${d}`,{country:c,division:d,count:players.filter(player=>player.c===c&&player.d===d).length}]))).sort((a,b)=>a.country.localeCompare(b.country,'pt-BR')||a.division-b.division)
const output={version:1,generatedAt:new Date().toISOString(),attributes:attributes.map(([key])=>key),markets,players}
const target=resolve('public/reference/players.v1.json')
await mkdir(resolve('public/reference'),{recursive:true})
await writeFile(target,JSON.stringify(output))
console.log(`Base anônima criada: ${players.length} jogadores em ${markets.length} mercados -> ${target}`)

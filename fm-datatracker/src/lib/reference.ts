import{attributeScore}from'./scoring'

export type ReferencePlayer={c:string;d:number;a:number|null;p:string;v:Array<number|null>}
export type ReferenceMarket={country:string;division:number;count:number}
export type ReferenceDataset={version:number;generatedAt:string;attributes:string[];markets:ReferenceMarket[];players:ReferencePlayer[]}
export type ReferenceLevel='Fraco'|'Abaixo da média'|'Médio'|'Bom'|'Excelente'|'Elite'

const countryAliases:Record<string,string>={brazil:'brasil',germany:'alemanha',argentina:'argentina',spain:'espanha',france:'franca',england:'inglaterra',italy:'italia'}
export const normalizeCountry=(value:string|null|undefined)=>{const key=(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();return countryAliases[key]??key}

export function positionFamily(value:string|string[]){
  const raw=(Array.isArray(value)?value[0]:value).toUpperCase().trim()
  if(/^GK(?:\s|\(|$)/.test(raw))return'GK'
  if(/^D(?:\s|\(|\/|$)/.test(raw))return'D'
  if(/^WB(?:\s|\(|\/|$)/.test(raw))return'WB'
  if(/^DM(?:\s|\(|\/|$)/.test(raw))return'DM'
  if(/^M(?:\s|\(|\/|$)/.test(raw))return'M'
  if(/^AM(?:\s|\(|\/|$)/.test(raw))return'AM'
  if(/^ST(?:\s|\(|\/|$)/.test(raw))return'ST'
  return'OUTRO'
}

export function positionFamilies(value:string|string[]){
  const raw=(Array.isArray(value)?value.join(','):value).toUpperCase(),found:string[]=[]
  for(const match of raw.matchAll(/(?:^|[,/]\s*)(GK|WB|DM|AM|ST|D|M)(?=\s|,|\/|\(|$)/g))if(!found.includes(match[1]))found.push(match[1])
  return found.length?found:[positionFamily(value)]
}

export function referenceScore(player:ReferencePlayer,attributes:string[],weights:Record<string,number>){
  return attributeScore(attributes.map((key,index)=>({key,value:player.v[index]??null,weight:weights[key]??1})))
}

export function percentile(score:number,sortedScores:number[]){
  if(!sortedScores.length)return null
  let low=0,high=sortedScores.length
  while(low<high){const middle=(low+high)>>>1;if(sortedScores[middle]<=score)low=middle+1;else high=middle}
  return Math.round(low/sortedScores.length*100)
}

export function referenceLevel(value:number):ReferenceLevel{
  if(value>=95)return'Elite'
  if(value>=85)return'Excelente'
  if(value>=65)return'Bom'
  if(value>=35)return'Médio'
  if(value>=15)return'Abaixo da média'
  return'Fraco'
}

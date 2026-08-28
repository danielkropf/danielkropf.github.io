import { pairedRoleScore, rawRoleScore, roleScore } from './role-scoring'
import { eligibleGeneralScoreFamilies, generalScoreForReference, type GeneralScoreSnapshot } from './base-position-score'

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

export function referenceAttributes(player:ReferencePlayer,attributes:string[]){
  return attributes.map((key,index)=>({key,value:player.v[index]??null}))
}

export function referenceScore(player:ReferencePlayer,attributes:string[],weights:Record<string,number>){
  return rawRoleScore(referenceAttributes(player,attributes),weights)
}

export function referenceRoleScore(player:ReferencePlayer,attributes:string[],weights:Record<string,number>){
  return roleScore(referenceAttributes(player,attributes),weights)
}

export function referencePairedRoleScore(player:ReferencePlayer,attributes:string[],ipWeights:Record<string,number>,oopWeights:Record<string,number>){
  return pairedRoleScore(referenceAttributes(player,attributes),ipWeights,oopWeights)
}

export function generalReferenceScoresByFamily(players:ReferencePlayer[],attributes:string[]){
  const groups:Record<string,number[]>={GK:[],D:[],WB:[],DM:[],M:[],AM:[],ST:[]}
  for(const player of players){
    const score=generalScoreForReference(player,attributes)?.score??null
    if(score===null)continue
    for(const family of positionFamilies(player.p))if(groups[family])groups[family].push(score)
  }
  for(const scores of Object.values(groups))scores.sort((a,b)=>a-b)
  return groups
}

export function percentile(score:number,sortedScores:number[]){
  if(!sortedScores.length)return null
  let low=0,high=sortedScores.length
  while(low<high){const middle=(low+high)>>>1;if(sortedScores[middle]<=score)low=middle+1;else high=middle}
  return Math.round(low/sortedScores.length*100)
}

export function generalReferencePercentile(score:number,snapshot:GeneralScoreSnapshot,groups:Record<string,number[]>){
  let best:{percentile:number;family:string;population:number[]}|null=null
  for(const family of eligibleGeneralScoreFamilies(snapshot)){
    const population=groups[family]??[]
    const value=percentile(score,population)
    if(value!==null&&(!best||value>best.percentile))best={percentile:value,family,population}
  }
  return best
}

export function referenceLevel(value:number):ReferenceLevel{
  if(value>=95)return'Elite'
  if(value>=85)return'Excelente'
  if(value>=65)return'Bom'
  if(value>=35)return'Médio'
  if(value>=15)return'Abaixo da média'
  return'Fraco'
}

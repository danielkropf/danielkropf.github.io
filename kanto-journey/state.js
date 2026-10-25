(function(G){
'use strict';
const bad=()=>{throw new Error('Save inválido ou incompatível')};
const integer=(x,min=0,max=1e9)=>Number.isInteger(x)&&x>=min&&x<=max;
const number=(x,min=0,max=1e12)=>Number.isFinite(x)&&x>=min&&x<=max;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const text=(x,max=240)=>typeof x==='string'&&x.length<=max;
const uid=x=>typeof x==='string'&&/^[a-z0-9]{1,32}$/.test(x);
const species=id=>integer(id,1,151)&&!!DEX[id];
const ids=a=>Array.isArray(a)&&a.length<=151&&a.every(species)&&new Set(a).size===a.length;
function pokemon(p){
 if(!object(p)||!species(p.id)||!uid(p.uid)||!integer(p.level,1,100)||!number(p.xp)||!object(p.up)||!['stats','power','special'].every(k=>integer(p.up[k],0,k==='special'?1:12)))bad();
 if(!number(p.hp,0,Kanto.stats(p)[0])||!Array.isArray(p.moves)||p.moves.length>2||new Set(p.moves).size!==p.moves.length||p.moves.some(n=>typeof n!=='string'||!MOVES[n]))bad();
 if(p.learned!==undefined&&(!Array.isArray(p.learned)||p.learned.length>400||p.learned.some(n=>typeof n!=='string'||!MOVES[n])))bad();
 return true;
}
function map(x,key,value){return object(x)&&Object.entries(x).every(([k,v])=>key(k)&&value(v))}
function validate(s){
 if(!object(s)||s.version!==1||typeof s.started!=='boolean'||![1,4,7].includes(s.starter)||!integer(s.unlocked,0,CAMPAIGN.length)||!integer(s.city,0,CAMPAIGN.length))bad();
 if(!Array.isArray(s.party)||!Array.isArray(s.pc)||s.party.length>6||s.party.length+s.pc.length>151)bad();
 if(s.started?!s.party.length:(s.party.length||s.pc.length||s.phase!=='starter'))bad();
 let all=[...s.party,...s.pc];all.forEach(pokemon);if(new Set(all.map(p=>p.uid)).size!==all.length)bad();
 let families=new Map();for(let p of all){let r=Kanto.root(p.id),set=families.get(r)||new Set();if((r!==133&&set.size)||set.has(p.id))bad();set.add(p.id);families.set(r,set)}
 if(families.get(133)?.has(133)&&[134,135,136].every(id=>families.get(133).has(id)))bad();
 if(!ids(s.caught)||!ids(s.seen)||!Array.isArray(s.badges)||s.badges.length>8||new Set(s.badges).size!==s.badges.length||s.badges.some(n=>!CAMPAIGN.some(c=>c.badge===n)))bad();
 if(!Array.isArray(s.log)||s.log.length>35||!s.log.every(x=>text(x,600))||!Array.isArray(s.achievements)||s.achievements.length>30||!s.achievements.every(x=>text(x,160)))bad();
 if(!map(s.bag,k=>!!ITEMS[k],n=>integer(n,0,1e6))||!map(s.candies,k=>species(+k)&&Kanto.root(+k)===+k,n=>integer(n,0,1e6)))bad();
 if(!number(s.money)||!integer(s.rng,1,2147483646)||!integer(s.totalWins)||!number(s.playtime)||![1,2,4,8].includes(s.speed)||typeof s.auto!=='boolean')bad();
 if(s.defeats!==undefined&&!integer(s.defeats))bad();
 if(s.checkpoint!==undefined&&s.checkpoint!==null&&(!integer(s.checkpoint,0,CAMPAIGN.length-1)||s.checkpoint!==s.unlocked))bad();
 if(!['starter','city','ready','boss','battle','capture'].includes(s.phase))bad();
 if(['ready','boss','battle','capture'].includes(s.phase)){
  let j=s.journey;if(!object(j)||!integer(j.index,0,Math.min(s.unlocked,CAMPAIGN.length-1))||!integer(j.pos,0,Kanto.journey(j.index).length)||typeof j.training!=='boolean'||typeof j.returning!=='boolean')bad();
 }
 if(s.phase==='boss'&&s.journey.pos!==Kanto.journey(s.journey.index).length)bad();
 if(s.phase==='capture'){
  let p=s.pending;if(!object(p)||!species(p.id)||!integer(p.level,1,100)||!integer(p.attempts,0,1e6)||typeof p.boss!=='boolean'||typeof p.returning!=='boolean')bad();
  if(p.boss&&p.bossIndex!==s.journey.index)bad();
 }
 if(s.phase==='battle'){
  let b=s.battle;if(!object(b)||!Array.isArray(b.enemies)||!b.enemies.length||b.enemies.length>6)bad();b.enemies.forEach(pokemon);
  if(!integer(b.active,0,s.party.length-1)||!integer(b.foe,0,b.enemies.length-1)||!text(b.name)||!integer(b.routeLevel,1,100)||!integer(b.turns,0,1e6))bad();
  if(!['clock','nextA','nextE','lock'].every(k=>number(b[k]))||!['trainer','boss','returning','swapLock'].every(k=>typeof b[k]==='boolean'))bad();
  if(b.boss&&b.bossIndex!==s.journey.index)bad();
  for(let side of ['A','E']){
   if(!map(b['cd'+side],k=>!!MOVES[k],v=>number(v))||!map(b['buff'+side],k=>/^[1-5]$/.test(k),v=>integer(v,-6,6)))bad();
   let st=b['status'+side];if(st!==null&&st!==undefined&&(!object(st)||!text(st.name,50)||!number(st.until)))bad();
  }
  if(b.cds!==undefined&&!map(b.cds,uid,v=>map(v,k=>!!MOVES[k],x=>number(x))))bad();
 }
 return s;
}
G.KantoState={validate,pokemon};
})(typeof window==='undefined'?globalThis:window);

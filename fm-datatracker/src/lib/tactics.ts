export type TacticPhase='IP'|'OOP'
export type PitchNode={id:string;position:string;x:number;y:number}
export type RoleOption=[code:string,name:string]

export const PITCH_NODES:PitchNode[]=[
  {id:'gk',position:'GK',x:50,y:93},
  {id:'dl',position:'D (L)',x:8,y:78},{id:'dcl',position:'D (C)',x:29,y:80},{id:'dc',position:'D (C)',x:50,y:81},{id:'dcr',position:'D (C)',x:71,y:80},{id:'dr',position:'D (R)',x:92,y:78},
  {id:'wbl',position:'WB (L)',x:8,y:64},{id:'dml',position:'DM (C)',x:29,y:64},{id:'dmc',position:'DM (C)',x:50,y:65},{id:'dmr',position:'DM (C)',x:71,y:64},{id:'wbr',position:'WB (R)',x:92,y:64},
  {id:'ml',position:'M (L)',x:8,y:48},{id:'mcl',position:'M (C)',x:29,y:48},{id:'mc',position:'M (C)',x:50,y:49},{id:'mcr',position:'M (C)',x:71,y:48},{id:'mr',position:'M (R)',x:92,y:48},
  {id:'aml',position:'AM (L)',x:8,y:31},{id:'amcl',position:'AM (C)',x:29,y:32},{id:'amc',position:'AM (C)',x:50,y:31},{id:'amcr',position:'AM (C)',x:71,y:32},{id:'amr',position:'AM (R)',x:92,y:31},
  {id:'stl',position:'ST (C)',x:29,y:14},{id:'stc',position:'ST (C)',x:50,y:11},{id:'str',position:'ST (C)',x:71,y:14}
]

export const IP_ROLES:Record<string,RoleOption[]>={
  GK:[['GK','Goalkeeper'],['NNGK','No-Nonsense Goalkeeper'],['BPGK','Ball-Playing Goalkeeper']],
  CB:[['CB','Centre-Back'],['BPCB','Ball-Playing Centre-Back'],['NNCB','No-Nonsense Centre-Back'],['ACB','Advanced Centre-Back'],['OCB','Overlapping Centre-Back']],
  FB:[['FB','Full Back'],['IFB','Inside Full-Back'],['PWB','Playmaking Wing-Back']],
  WB:[['WB','Wing Back'],['IWB','Inside Wing-Back'],['PWB','Playmaking Wing-Back'],['AWB','Advanced Wing-Back']],
  DM:[['DM','Defensive Midfielder'],['DLP','Deep-Lying Playmaker'],['HB','Half Back'],['B2BM','Box-To-Box Midfielder'],['B2BP','Box-To-Box Playmaker']],
  CM:[['CM','Central Midfielder'],['MP','Midfield Playmaker'],['WCM','Wide Central Midfielder']],
  WM:[['WM','Wide Midfielder'],['W','Winger'],['IW','Inside Winger'],['PW','Playmaking Winger']],
  AM:[['AM','Attacking Midfielder'],['AP','Advanced Playmaker'],['CHM','Channel Midfielder'],['FR','Free Role'],['SS','Second Striker']],
  W:[['W','Winger'],['IW','Inside Winger'],['IF','Inside Forward'],['PW','Playmaking Winger'],['WF','Wide Forward']],
  ST:[['CF','Centre Forward'],['CHF','Channel Forward'],['DLF','Deep-Lying Forward'],['F9','False Nine'],['P','Poacher'],['TF','Target Forward']]
}

export const OOP_ROLES:Record<string,RoleOption[]>={
  GK:[['GK','Goalkeeper'],['LHK','Line-Holding Keeper'],['SK','Sweeper Keeper']],
  CB:[['CB','Centre-Back'],['CCB','Covering Centre-Back'],['SCB','Stopping Centre-Back']],
  FB:[['FB','Full Back'],['HFB','Holding Full-Back'],['PFB','Pressing Full-Back']],
  WB:[['WB','Wing Back'],['HWB','Holding Wing-Back'],['PWB','Pressing Wing-Back']],
  DM:[['DM','Defensive Midfielder'],['DDM','Dropping Defensive Midfielder'],['SDM','Screening Defensive Midfielder'],['WCDM','Wide Covering Defensive Midfielder']],
  CM:[['CM','Central Midfielder'],['PCM','Pressing Central Midfielder'],['SCM','Screening Central Midfielder'],['WCCM','Wide Covering Central Midfielder']],
  WM:[['WM','Wide Midfielder'],['TWM','Tracking Wide Midfielder'],['WOWM','Wide Outlet Wide Midfielder']],
  AM:[['AM','Attacking Midfielder'],['COAM','Central Outlet Attacking Midfielder'],['SOAM','Splitting Outlet Attacking Midfielder'],['TAM','Tracking Attacking Midfielder']],
  W:[['W','Winger'],['IOW','Inside Outlet Winger'],['TW','Tracking Winger'],['WOW','Wide Outlet Winger']],
  ST:[['CF','Centre Forward'],['COCF','Central Outlet Centre Forward'],['SOCF','Splitting Outlet Centre Forward'],['TCF','Tracking Centre Forward']]
}

export function positionGroup(position:string){
  if(position==='GK')return'GK'
  if(position.startsWith('D (C)'))return'CB'
  if(position.startsWith('D ('))return'FB'
  if(position.startsWith('WB'))return'WB'
  if(position.startsWith('DM'))return'DM'
  if(position.startsWith('M (C)'))return'CM'
  if(position.startsWith('M ('))return'WM'
  if(position.startsWith('AM (C)'))return'AM'
  if(position.startsWith('AM ('))return'W'
  return'ST'
}

export function rolesFor(position:string,phase:TacticPhase='IP'){
  const source=phase==='IP'?IP_ROLES:OOP_ROLES
  return source[positionGroup(position)]??source.CM
}

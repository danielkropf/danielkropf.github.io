export type PitchNode={id:string;position:string;x:number;y:number}
export const PITCH_NODES:PitchNode[]=[
{id:'gk',position:'GK',x:50,y:92},{id:'dl',position:'D (L)',x:15,y:77},{id:'dcl',position:'D (C)',x:38,y:79},{id:'dcr',position:'D (C)',x:62,y:79},{id:'dr',position:'D (R)',x:85,y:77},{id:'wbl',position:'WB (L)',x:8,y:65},{id:'wbr',position:'WB (R)',x:92,y:65},{id:'dml',position:'DM (L)',x:28,y:62},{id:'dmc',position:'DM (C)',x:50,y:62},{id:'dmr',position:'DM (R)',x:72,y:62},{id:'ml',position:'M (L)',x:20,y:47},{id:'mcl',position:'M (C)',x:40,y:48},{id:'mcr',position:'M (C)',x:60,y:48},{id:'mr',position:'M (R)',x:80,y:47},{id:'aml',position:'AM (L)',x:18,y:28},{id:'amc',position:'AM (C)',x:50,y:31},{id:'amr',position:'AM (R)',x:82,y:28},{id:'stl',position:'ST (C)',x:35,y:14},{id:'stc',position:'ST (C)',x:50,y:11},{id:'str',position:'ST (C)',x:65,y:14}]
export const ROLE_OPTIONS:Record<string,Array<[string,string]>>={
GK:[['GK','Goalkeeper'],['SK','Sweeper Keeper']],
D:[['CD','Central Defender'],['BPD','Ball-Playing Defender'],['NCB','No-Nonsense Centre-Back'],['LIB','Libero'],['WCB','Wide Centre-Back']],
WB:[['FB','Full-Back'],['WB','Wing-Back'],['CWB','Complete Wing-Back'],['IWB','Inverted Wing-Back'],['IFB','Inverted Full-Back']],
DM:[['DM','Defensive Midfielder'],['A','Anchor'],['HB','Half Back'],['DLP','Deep-Lying Playmaker'],['SV','Segundo Volante'],['BWM','Ball-Winning Midfielder'],['RPM','Roaming Playmaker']],
M:[['CM','Central Midfielder'],['BBM','Box-to-Box Midfielder'],['DLP','Deep-Lying Playmaker'],['AP','Advanced Playmaker'],['MEZ','Mezzala'],['CAR','Carrilero'],['BWM','Ball-Winning Midfielder'],['RPM','Roaming Playmaker']],
AM:[['AM','Attacking Midfielder'],['AP','Advanced Playmaker'],['W','Winger'],['IF','Inside Forward'],['IW','Inverted Winger'],['SS','Shadow Striker'],['T','Trequartista'],['RMD','Raumdeuter']],
ST:[['AF','Advanced Forward'],['DLF','Deep-Lying Forward'],['CF','Complete Forward'],['P','Poacher'],['TF','Target Forward'],['PF','Pressing Forward'],['F9','False Nine']]}
export function positionGroup(position:string){if(position==='GK')return'GK';if(position.startsWith('WB'))return'WB';if(position.startsWith('DM'))return'DM';if(position.startsWith('AM'))return'AM';if(position.startsWith('ST'))return'ST';if(position.startsWith('D'))return'D';return'M'}
export function rolesFor(position:string){return ROLE_OPTIONS[positionGroup(position)]??ROLE_OPTIONS.M}

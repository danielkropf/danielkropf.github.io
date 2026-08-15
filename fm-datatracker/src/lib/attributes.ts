export type AttributeCategory='technical'|'mental'|'physical'|'goalkeeping'
export type AttributeDefinition={key:string;label:string;category:AttributeCategory}
const group=(category:AttributeCategory,items:Array<[string,string]>):AttributeDefinition[]=>items.map(([key,label])=>({key,label,category}))
export const ATTRIBUTE_CATALOG=[
...group('technical',[['corners','Corners'],['crossing','Crossing'],['dribbling','Dribbling'],['finishing','Finishing'],['first_touch','First Touch'],['free_kick_taking','Free Kick Taking'],['heading','Heading'],['long_shots','Long Shots'],['long_throws','Long Throws'],['marking','Marking'],['passing','Passing'],['penalty_taking','Penalty Taking'],['tackling','Tackling'],['technique','Technique']]),
...group('mental',[['aggression','Aggression'],['anticipation','Anticipation'],['bravery','Bravery'],['composure','Composure'],['concentration','Concentration'],['decisions','Decisions'],['determination','Determination'],['flair','Flair'],['leadership','Leadership'],['off_the_ball','Off The Ball'],['positioning','Positioning'],['team_work','Team Work'],['vision','Vision'],['work_rate','Work Rate']]),
...group('physical',[['acceleration','Acceleration'],['agility','Agility'],['balance','Balance'],['jumping_reach','Jumping Reach'],['natural_fitness','Natural Fitness'],['pace','Pace'],['stamina','Stamina'],['strength','Strength']]),
...group('goalkeeping',[['aerial_reach','Aerial Reach'],['command_of_area','Command Of Area'],['communication','Communication'],['eccentricity','Eccentricity'],['handling','Handling'],['kicking','Kicking'],['one_on_ones','One On Ones'],['punching','Punching'],['reflexes','Reflexes'],['rushing_out_tendency','Rushing Out (Tendency)'],['throwing','Throwing']])]
export const DEFAULT_ATTRIBUTE_WEIGHTS=Object.fromEntries(ATTRIBUTE_CATALOG.map(a=>[a.key,1])) as Record<string,number>
export const ATTRIBUTE_LOOKUP=Object.fromEntries(ATTRIBUTE_CATALOG.map(a=>[a.key,a])) as Record<string,AttributeDefinition>

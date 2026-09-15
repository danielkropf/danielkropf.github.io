import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
it('persists evidence atomically, retains history on import deletion, rejects identity collisions and enforces ownership',async()=>{
 const db=new PGlite(), owner='00000000-0000-4000-8000-000000000001',save='00000000-0000-4000-8000-000000000002'
 try{
  await db.exec(`create role authenticated; create role anon; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table public.saves(id uuid primary key,owner_id uuid); create table public.imports(id uuid primary key default gen_random_uuid(),save_id uuid,hash text,unique(id,save_id),unique(save_id,hash)); create table public.players(save_id uuid,fm_player_id text,date_of_birth date);
   create function public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb) returns jsonb language plpgsql as $$declare i uuid; begin insert into public.imports(save_id,hash) values($1,$5) on conflict(save_id,hash) do update set hash=excluded.hash returning id into i;return jsonb_build_object('import_id',i);end$$;
   insert into auth.users values('${owner}'); insert into public.saves values('${save}','${owner}');select set_config('request.jwt.claim.sub','${owner}',false);`)
  await db.exec(await readFile(new URL('../../supabase/migrations/20260915005520_automatic_intake_evidence.sql',import.meta.url),'utf8'))
  const cohort={key:'700:2030-09-22',team_id:700,intake_date:'2030-09-22',confidence:'supported',method:'news_envelope_and_trial_cohort',members:[{uid:'123',birth_date:'2014-01-01',name:'Youth'}]}
  const payload={version:'fm26-intakes-v1',checkpoint_date:'2030-09-22',classes:[cohort]}
  const call=(hash:string,p:unknown=payload,rows:unknown[]=[])=>db.query('select public.import_fm_with_intakes($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)',[save,'test.fm','squad','2030-09-22',hash,',','[]',JSON.stringify(rows),JSON.stringify(p)])
  await call('one');await call('one')
  expect((await db.query('select * from fm_intake_observations')).rows).toHaveLength(1)
  await expect(call('bad',{...payload,classes:[{...cohort,members:[{uid:'123'}]}]})).rejects.toThrow('Identidade')
  expect((await db.query('select * from imports')).rows).toHaveLength(1)
  await db.exec(`insert into players values('${save}','123','2012-01-01')`)
  await expect(call('conflict',payload,[{fm_player_id:'123',date_of_birth:'2014-01-01'}])).rejects.toThrow('Conflito de identidade')
  await db.exec('delete from imports')
  expect((await db.query('select source_import_id from fm_intake_observations')).rows).toEqual([{source_import_id:null}])
  await db.exec(`grant usage on schema public,auth to authenticated; grant select,update on saves to authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false); set role authenticated;`)
  expect((await db.query('select * from fm_intake_observations')).rows).toHaveLength(0)
  await expect(db.exec(`insert into fm_intake_reviews values('${save}','700:2030-09-22','00000000-0000-4000-8000-000000000099','confirmed',now())`)).rejects.toThrow()
  await expect(call('foreign')).rejects.toThrow('Save não encontrado')
 }finally{await db.close()}
},30000)

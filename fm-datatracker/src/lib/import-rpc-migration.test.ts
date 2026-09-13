import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
it('imports attributes atomically, deduplicates retries and rejects another owner', async () => {
  const db = new PGlite()
  const owner='00000000-0000-4000-8000-000000000001', save='00000000-0000-4000-8000-000000000002'
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`)
    const initial=await readFile(new URL('../../supabase/migrations/202608150001_initial_schema.sql',import.meta.url),'utf8')
    for(const table of ['saves','imports','players','player_snapshots','player_attributes','player_stats','contracts']) {
      const statement=initial.split('\n').find(line=>line.startsWith(`create table public.${table} `))
      if(statement) await db.exec(statement)
    }
    await db.exec(`create function public.datatracker_sync_fm_membership_rows(uuid,uuid,date,jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$; create function public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$; insert into auth.users values('${owner}'); insert into public.saves(id,owner_id,name,club_name) values('${save}','${owner}','Test','Club'); select set_config('request.jwt.claim.sub','${owner}',false);`)
    const migration=await readFile(new URL('../../supabase/migrations/20260913150838_import_rpc_timeout_and_attribute_batch.sql',import.meta.url),'utf8')
    await db.exec(migration)
    const row={fm_player_id:'123',current_name:'Player',normalized_name:'player',attributes:[{attribute_key:'pace',attribute_label:'Pace',source_column:'Pace',value:12,category:'physical'},{attribute_key:'passing',attribute_label:'Passing',source_column:'Passing',value:14,category:'technical'}]}
    const call=(hash:string, rows:unknown[])=>db.query<{r:any}>('select public.import_fm_export($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) r',[save,'test.csv','squad','2030-07-01',hash,',','[]',JSON.stringify(rows),'[]'])
    expect((await call('one',[row])).rows[0].r.duplicate).toBe(false)
    expect((await call('one',[row])).rows[0].r.duplicate).toBe(true)
    expect((await db.query('select attribute_key,value from public.player_attributes order by attribute_key')).rows).toEqual([{attribute_key:'pace',value:'12'},{attribute_key:'passing',value:'14'}])
    await expect(call('bad',[row,{...row,fm_player_id:'456',attributes:[{attribute_key:'pace',value:'invalid'}]}])).rejects.toThrow()
    expect((await db.query('select * from public.imports')).rows).toHaveLength(1)
    expect((await db.query('select * from public.player_snapshots')).rows).toHaveLength(1)
    await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false)")
    await expect(call('foreign',[row])).rejects.toThrow('Save não encontrado')
    const configs=(await db.query<{proconfig:string[];prosecdef:boolean}>("select proconfig,prosecdef from pg_proc where proname='import_fm_export'")).rows
    expect(configs.every(item=>item.proconfig.includes('statement_timeout=55s')&&!item.prosecdef)).toBe(true)
  } finally { await db.close() }
},30000)

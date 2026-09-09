import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

// Executes the actual legacy and new PL/pgSQL function in isolated PostgreSQL.
// Auth and the minimal tables are fixtures, not a claim to emulate hosted Auth/RLS.
it('upgrades legacy reader evidence once, preserves audit history, and keeps transaction/ownership fences', async () => {
  const db = new PGlite()
  const owner='00000000-0000-4000-8000-000000000001', save='00000000-0000-4000-8000-000000000002', imp='00000000-0000-4000-8000-000000000003', player='00000000-0000-4000-8000-000000000004', snap='00000000-0000-4000-8000-000000000005'
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema storage; create table storage.buckets(id text,public boolean);
      create schema cron; create table cron.job(jobname text);
      create table public.saves(id uuid,club_name text);
      create table public.save_clubs(save_id uuid,tracking_role text,is_active boolean);
      create table public.player_stats(id uuid);
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.imports(id uuid primary key,save_id uuid,owner_id uuid,status text,snapshot_date date,source_schema jsonb);
      create table public.players(id uuid primary key,save_id uuid,owner_id uuid,fm_player_id text);
      create table public.player_snapshots(id uuid primary key,save_id uuid,player_id uuid,import_id uuid,snapshot_date date);
      create table public.player_memberships(id uuid primary key default gen_random_uuid(),save_id uuid,owner_id uuid,player_id uuid,observed_date date,current_club_id uuid,owner_club_id uuid,team_level text,squad_name text,is_loan boolean,loan_from_club_id uuid,loan_to_club_id uuid,source_snapshot_id uuid,source_import_id uuid,source_kind text,provenance jsonb);
      create function public.datatracker_bind_structural_organization(uuid,uuid,uuid,uuid,uuid,jsonb) returns jsonb language sql as $$ select '{"status":"unknown"}'::jsonb $$;
      create table public.contracts(player_id uuid,owner_id uuid,snapshot_date date,expiry_date date,unique(player_id,snapshot_date));
      select set_config('request.jwt.claim.sub','${owner}',false);
      insert into public.imports values('${imp}','${save}','${owner}','imported','2026-03-30','{}');
      insert into public.players values('${player}','${save}','${owner}','10');
      insert into public.player_snapshots values('${snap}','${save}','${player}','${imp}','2026-03-30');
    `)
    const legacyFile = await readFile(new URL('../../supabase/migrations/20260903000100_emc01b_factual_membership.sql', import.meta.url),'utf8')
    const start=legacyFile.indexOf('create or replace function public.datatracker_sync_fm_membership_rows(')
    await db.exec(legacyFile.slice(start,legacyFile.indexOf('\n$$;',start)+4))
    const unknown={status:'unknown',value:null,evidence_refs:[],reason_code:'unresolved'}
    const old={fm_player_id:'10',facts_schema:'membership_facts_v1',facts_version:'e-mc-01-v1',sync_version:'e-mc-01b-v1',checkpoint_date:'2026-03-30',structural_squad:{status:'confirmed',value:{label_raw:'Principal'},evidence_refs:[]},organization_identity:unknown,current_organization:unknown,owner_organization:unknown,is_loan:unknown,loan_from_organization:unknown,loan_to_organization:unknown,team_level:unknown,contract_facts:{contract_expiry:unknown,current_standard_contract:unknown},raw_structural_membership:{roster_group_label_raw:'Principal'}}
    const call = (rows: unknown[], date='2026-03-30') => db.query<{ result: { synced_rows: number; idempotent_rows: number } }>('select public.datatracker_sync_fm_membership_rows($1,$2,$3,$4::jsonb) result',[save,imp,date,JSON.stringify(rows)])
    await call([old])
    const beforeSnapshots=await db.query('select * from public.player_snapshots')
    await db.exec(await readFile(new URL('../../supabase/migrations/20260909142039_reader_033_membership_refresh.sql',import.meta.url),'utf8'))
    const schema=(await db.query<{info:any}>('select public.datatracker_schema_info() info')).rows[0].info
    expect(schema.schema_version).toBe('202609091420')
    expect(schema.capabilities.reader_033_membership_refresh).toBe(true)
    const upgraded={...old,reader_version:'fm26-membership-reader/0.33.0',structural_squad:{status:'confirmed',value:{label_raw:'Example II'},evidence_refs:['game_db.dat@123']}}
    expect((await call([upgraded])).rows[0].result.synced_rows).toBe(1)
    const row=(await db.query<{squad_name:string;provenance:any}>('select squad_name,provenance from public.player_memberships')).rows[0]
    expect(row.squad_name).toBe('Example II')
    expect(row.provenance.previous_reader_observation.squad_name).toBe('Principal')
    expect(row.provenance.membership_reader_version).toBe(upgraded.reader_version)
    expect((await call([upgraded])).rows[0].result.idempotent_rows).toBe(1)
    expect((await db.query('select * from public.player_snapshots')).rows).toEqual(beforeSnapshots.rows)
    await expect(call([{...upgraded,is_loan:{status:'confirmed',value:true}}])).rejects.toThrow('same-source')
    await expect(call([upgraded],'2026-03-31')).rejects.toThrow('checkpoint')
    await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false)")
    await expect(call([upgraded])).rejects.toThrow('import não encontrado')
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`)
    // An earlier row of a failed batch must not remain committed.
    await db.exec(`insert into public.players values('00000000-0000-4000-8000-000000000006','${save}','${owner}','20'); insert into public.player_snapshots values('00000000-0000-4000-8000-000000000007','${save}','00000000-0000-4000-8000-000000000006','${imp}','2026-03-30');`)
    await expect(call([{...upgraded,fm_player_id:'20'},{...upgraded,is_loan:{status:'confirmed',value:true}}])).rejects.toThrow('same-source')
    expect((await db.query('select * from public.player_memberships')).rows).toHaveLength(1)
    await call([{...upgraded,fm_player_id:'20',organization_identity:{status:'confirmed',value:{organization_ref:'owner-org'}},current_organization:{status:'confirmed',value:{organization_ref:'receiving-org'}},team_level:{status:'confirmed',value:'first_team'}}])
    const receivingMembership = (await db.query<{squad_name:string|null;team_level:string}>('select squad_name,team_level from public.player_memberships where player_id=$1',['00000000-0000-4000-8000-000000000006'])).rows[0]
    expect(receivingMembership.squad_name).toBeNull()
    expect(receivingMembership.team_level).toBe('unknown')
  } finally { await db.close() }
}, 30000)

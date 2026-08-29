-- FM DataTracker — Phase 0A / 3 of 3
-- Core Longitudinal Domain: RLS, explicit Data API grants and capability marker.

alter table public.clubs enable row level security;
alter table public.save_clubs enable row level security;
alter table public.seasons enable row level security;
alter table public.player_memberships enable row level security;
alter table public.intake_classes enable row level security;
alter table public.intake_class_members enable row level security;
alter table public.save_events enable row level security;
alter table public.event_decision_links enable row level security;

revoke all on table public.clubs, public.save_clubs, public.seasons, public.player_memberships,
  public.intake_classes, public.intake_class_members, public.save_events, public.event_decision_links from anon;
grant select, insert, update, delete on table public.clubs, public.save_clubs, public.seasons, public.player_memberships,
  public.intake_classes, public.intake_class_members, public.save_events, public.event_decision_links to authenticated, service_role;

create policy clubs_owner on public.clubs for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy save_clubs_owner on public.save_clubs for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy seasons_owner on public.seasons for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy player_memberships_owner on public.player_memberships for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy intake_classes_owner on public.intake_classes for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy intake_class_members_owner on public.intake_class_members for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy save_events_owner on public.save_events for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy event_decision_links_owner on public.event_decision_links for all to authenticated
  using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));

create or replace function public.datatracker_schema_info()
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_import_rpc boolean := to_regprocedure('public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb)') is not null;
  v_delete_rpc boolean := to_regprocedure('public.delete_fm_import(uuid,uuid)') is not null;
  v_model_patch boolean := to_regprocedure('public.patch_scoring_model_config(uuid,text,text,jsonb)') is not null;
  v_projections boolean := to_regclass('public.player_projections') is not null;
  v_diag_table boolean := to_regclass('public.fm_reader_samples') is not null;
  v_diag_bucket boolean := exists(select 1 from storage.buckets where id='fm-reader-samples' and public=false);
  v_diag_reservation boolean := exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='fm_reader_samples' and column_name='storage_prefix'
  );
  v_diag_retention boolean :=
    exists(select 1 from pg_extension where extname='pg_cron')
    and exists(select 1 from pg_extension where extname='pg_net')
    and exists(select 1 from cron.job where jobname='fm-reader-samples-retention');
  v_longitudinal_core boolean :=
    to_regclass('public.clubs') is not null
    and to_regclass('public.save_clubs') is not null
    and to_regclass('public.seasons') is not null
    and to_regclass('public.player_memberships') is not null
    and to_regclass('public.intake_classes') is not null
    and to_regclass('public.intake_class_members') is not null
    and to_regclass('public.save_events') is not null
    and to_regclass('public.event_decision_links') is not null;
  v_features text[] := array['schema_version_marker'];
begin
  if v_import_rpc then v_features := array_append(v_features,'import_fm_export'); end if;
  if v_delete_rpc then v_features := array_append(v_features,'delete_fm_import'); end if;
  if v_model_patch then v_features := array_append(v_features,'patch_scoring_model_config'); end if;
  if v_projections then v_features := array_append(v_features,'player_projections_v1'); end if;
  if v_diag_table and v_diag_bucket and v_diag_reservation then v_features := array_append(v_features,'fm_reader_diagnostics_v2'); end if;
  if v_diag_retention then v_features := array_append(v_features,'fm_reader_diagnostics_server_retention'); end if;
  if v_longitudinal_core then v_features := array_append(v_features,'core_longitudinal_domain_v1'); end if;

  return jsonb_build_object(
    'schema_version','202608290001',
    'app_version','0.27.0',
    'features',to_jsonb(v_features),
    'capabilities',jsonb_build_object(
      'import_rpc',v_import_rpc,
      'delete_import_rpc',v_delete_rpc,
      'model_config_patch',v_model_patch,
      'projections',v_projections,
      'diagnostics_table',v_diag_table,
      'diagnostics_bucket',v_diag_bucket,
      'diagnostics_reservations',v_diag_reservation,
      'diagnostics_upload',v_diag_table and v_diag_bucket and v_diag_reservation,
      'diagnostics_server_retention',v_diag_retention,
      'longitudinal_core',v_longitudinal_core
    )
  );
end
$$;

notify pgrst,'reload schema';

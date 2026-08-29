-- FM DataTracker — Phase 0F read-only longitudinal verification.
-- Every numeric violation count below should be zero.

select public.datatracker_schema_info() as schema_info;

select jsonb_build_object(
  'saves_without_active_primary',
  (
    select count(*)
    from public.saves s
    where not s.is_archived
      and nullif(btrim(s.club_name),'') is not null
      and not exists(
        select 1 from public.save_clubs sc
        where sc.save_id=s.id and sc.tracking_role='primary' and sc.is_active
      )
  ),
  'multiple_active_primary',
  (
    select count(*)
    from (
      select save_id
      from public.save_clubs
      where tracking_role='primary' and is_active
      group by save_id
      having count(*)>1
    ) q
  ),
  'snapshots_without_membership',
  (
    select count(*)
    from public.player_snapshots ps
    where not exists(
      select 1 from public.player_memberships pm
      where pm.source_snapshot_id=ps.id
        and pm.player_id=ps.player_id
        and pm.save_id=ps.save_id
    )
  ),
  'membership_cross_save_player',
  (
    select count(*)
    from public.player_memberships pm
    join public.players p on p.id=pm.player_id
    where p.save_id<>pm.save_id or p.owner_id<>pm.owner_id
  ),
  'tracked_club_cross_save',
  (
    select count(*)
    from public.save_clubs sc
    join public.clubs c on c.id=sc.club_id
    where c.save_id<>sc.save_id or c.owner_id<>sc.owner_id
  ),
  'class_member_cross_save',
  (
    select count(*)
    from public.intake_class_members m
    join public.intake_classes c on c.id=m.intake_class_id
    join public.players p on p.id=m.player_id
    where c.save_id<>m.save_id
       or c.owner_id<>m.owner_id
       or p.save_id<>m.save_id
       or p.owner_id<>m.owner_id
  ),
  'derived_event_without_version',
  (
    select count(*) from public.save_events
    where source_kind='derived' and derivation_version is null
  )
) as phase0_integrity;

select jsonb_object_agg(relname, relrowsecurity order by relname) as longitudinal_rls
from pg_class
join pg_namespace on pg_namespace.oid=pg_class.relnamespace
where pg_namespace.nspname='public'
  and relname in (
    'clubs','save_clubs','seasons','player_memberships',
    'intake_classes','intake_class_members','save_events','event_decision_links'
  );

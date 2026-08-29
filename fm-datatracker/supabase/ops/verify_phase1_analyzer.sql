-- FM DataTracker — Phase 1A Analyzer verification (read only)
select public.datatracker_schema_info() as schema_info;

select count(*) as stats_with_context_mismatch
from public.player_stats
where (nullif(btrim(normalized_stats->>'season'),'') is not null and season is distinct from nullif(btrim(normalized_stats->>'season'),''))
   or (nullif(btrim(normalized_stats->>'competition'),'') is not null and competition is distinct from nullif(btrim(normalized_stats->>'competition'),''))
   or (nullif(btrim(normalized_stats->>'team'),'') is not null and team is distinct from nullif(btrim(normalized_stats->>'team'),''));

select count(*) as stats_with_negative_sample
from public.player_stats
where coalesce(minutes,0)<0 or coalesce(appearances,0)<0 or coalesce(starts,0)<0 or coalesce(sub_appearances,0)<0;

select count(*) as impossible_appearance_breakdown
from public.player_stats
where appearances is not null and starts is not null and sub_appearances is not null
  and appearances <> starts + sub_appearances;

select count(*) as performance_scores_present
from public.player_scores
where score_type='performance' or performance_score is not null;

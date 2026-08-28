-- Run only after Vault contains:
--   fm_datatracker_project_url = https://<project-ref>.supabase.co
--   fm_datatracker_anon_jwt   = the environment's legacy anon JWT
--
-- Safe to rerun: replaces the named cron schedule without touching diagnostic rows.

select cron.unschedule(jobid)
from cron.job
where jobname='fm-reader-samples-retention';

select cron.schedule(
  'fm-reader-samples-retention',
  '17 4 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='fm_datatracker_project_url') || '/functions/v1/cleanup-fm-reader-samples',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='fm_datatracker_anon_jwt'),
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='fm_datatracker_anon_jwt')
    ),
    body := jsonb_build_object('scheduled_at', now()),
    timeout_milliseconds := 10000
  ) as request_id;
  $job$
);

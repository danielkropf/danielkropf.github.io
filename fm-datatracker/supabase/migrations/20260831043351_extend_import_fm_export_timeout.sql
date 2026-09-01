-- Mirrors the production hotfix that keeps the global authenticated timeout
-- unchanged while allowing the atomic FM import RPC to finish large saves.
alter function public.import_fm_export(
  uuid, text, text, date, text, text, jsonb, jsonb
) set statement_timeout = '60s';

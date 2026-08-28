-- Keep pg_net out of public, matching Supabase's recommended extension placement.
drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;

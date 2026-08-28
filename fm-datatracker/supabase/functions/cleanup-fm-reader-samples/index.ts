import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "fm-reader-samples";
const BATCH_SIZE = 250;

type DiagnosticSample = {
  id: string;
  fm_path: string | null;
  csv_path: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "missing_runtime_configuration" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cutoff = new Date().toISOString();

  const { data, error } = await admin
    .from("fm_reader_samples")
    .select("id,fm_path,csv_path")
    .lt("expires_at", cutoff)
    .order("expires_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) return json({ error: "select_failed", detail: error.message }, 500);

  let cleaned = 0;
  const failures: Array<{ id: string; stage: string; detail: string }> = [];

  for (const row of (data ?? []) as DiagnosticSample[]) {
    const paths = [row.fm_path, row.csv_path].filter((path): path is string => Boolean(path));

    if (paths.length > 0) {
      const { error: storageError } = await admin.storage.from(BUCKET).remove(paths);
      if (storageError) {
        failures.push({ id: row.id, stage: "storage", detail: storageError.message });
        continue;
      }

      const { error: checkpointError } = await admin
        .from("fm_reader_samples")
        .update({ fm_path: null, csv_path: null, status: "failed" })
        .eq("id", row.id)
        .lt("expires_at", cutoff);
      if (checkpointError) {
        failures.push({ id: row.id, stage: "checkpoint", detail: checkpointError.message });
        continue;
      }
    }

    const { error: deleteError } = await admin
      .from("fm_reader_samples")
      .delete()
      .eq("id", row.id)
      .lt("expires_at", cutoff);
    if (deleteError) {
      failures.push({ id: row.id, stage: "metadata", detail: deleteError.message });
      continue;
    }

    cleaned += 1;
  }

  return json({ attempted: data?.length ?? 0, cleaned, failures });
});

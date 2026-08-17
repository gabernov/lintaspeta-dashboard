// Edge Function: export-parquet
// Flow: dashboard (super_admin JWT) -> this function -> publish RPC (with user JWT)
//       -> GitHub repository_dispatch -> workflow builds parquet + deploys portal
import { createClient } from "jsr:@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const githubToken = Deno.env.get("GITHUB_DISPATCH_TOKEN")!;
const githubRepo = Deno.env.get("GITHUB_REPO") ?? "gabernov/lintaspeta-dashboard";

const DATASETS = ["ruas_jalan", "sekolah", "rambu", "apj"];

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // 1. Recover the USER's JWT (not the service key) from the Authorization header
    const authHeader = req.headers.get("Authorization") ?? "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!userJwt) {
      return new Response(JSON.stringify({ error: "missing Authorization header" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 2. Verify the session and role via Supabase Auth (user JWT)
    const admin = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(userJwt);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "invalid session" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const role = userData.user.app_metadata?.role;
    if (role !== "super_admin") {
      return new Response(JSON.stringify({ error: "forbidden: super_admin only" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 3. Call publish RPC with the USER's JWT (RLS + role check inside run as the user)
    const body = await req.json().catch(() => ({}));
    const datasets = Array.isArray(body.datasets) && body.datasets.length > 0
      ? body.datasets.filter((d: string) => DATASETS.includes(d))
      : DATASETS;
    if (datasets.length === 0) {
      return new Response(JSON.stringify({ error: "no valid datasets" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, unknown> = {};
    for (const ds of datasets) {
      const { data, error } = await admin.rpc("publish_dataset_safe", { p_dataset: ds });
      if (error) {
        results[ds] = { error: error.message };
      } else {
        results[ds] = data;
      }
    }

    // 4. Trigger GitHub workflow to build parquet + deploy portal
    const dispatch = await fetch(`https://api.github.com/repos/${githubRepo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "User-Agent": "lintaspeta-export",
      },
      body: JSON.stringify({
        event_type: "publish-data",
        client_payload: { datasets, results },
      }),
    });

    if (!dispatch.ok) {
      const text = await dispatch.text();
      return new Response(
        JSON.stringify({ published: results, dispatchError: text }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ published: results, dispatched: true }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

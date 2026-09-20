import { errorResponse, json } from "../_lib/authz.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export async function GET(): Promise<Response> {
  const started = Date.now();
  try {
    if (!supabaseAdmin) throw new Error("Supabase admin unavailable");
    const dbStart = Date.now();
    const { error } = await supabaseAdmin
      .from("stations")
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    const dbLatency = Date.now() - dbStart;
    const now = new Date().toISOString();
    const [sync, anomalies, etims] = await Promise.all([
      supabaseAdmin
        .from("sync_outbox")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "failed", "conflict"]),
      supabaseAdmin
        .from("anomaly_events")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      supabaseAdmin
        .from("etims_documents")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "retry", "rejected"]),
    ]);
    const status =
      dbLatency > 1500 || (sync.count || 0) > 100 ? "warning" : "ok";
    await supabaseAdmin.from("system_health_metrics").insert([
      {
        service: "database",
        metric_name: "latency",
        metric_value: dbLatency,
        unit: "ms",
        status: dbLatency > 1500 ? "warning" : "ok",
        recorded_at: now,
      },
      {
        service: "sync",
        metric_name: "exceptions",
        metric_value: sync.count || 0,
        unit: "count",
        status: (sync.count || 0) > 100 ? "warning" : "ok",
        recorded_at: now,
      },
      {
        service: "anomaly",
        metric_name: "open_events",
        metric_value: anomalies.count || 0,
        unit: "count",
        status: "ok",
        recorded_at: now,
      },
      {
        service: "etims",
        metric_name: "queue_backlog",
        metric_value: etims.count || 0,
        unit: "count",
        status: (etims.count || 0) > 50 ? "warning" : "ok",
        recorded_at: now,
      },
    ]);
    return json({
      success: true,
      status,
      database: { latencyMs: dbLatency },
      sync: { exceptions: sync.count || 0 },
      anomalies: { open: anomalies.count || 0 },
      etims: { backlog: etims.count || 0 },
      apiLatencyMs: Date.now() - started,
      timestamp: now,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

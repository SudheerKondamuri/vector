import { getProductionConfig } from "../../../lib/production/config";
import { checkPostgresHealth, createPostgresPilotStore } from "../../../lib/pilot-server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getProductionConfig();
    if (config.storage === "postgres") {
      await checkPostgresHealth(config.databaseUrl);
      if (process.env.NODE_ENV === "production" && !(await createPostgresPilotStore(config.databaseUrl!).workerReady(Number(process.env.VECTOR_WORKER_HEARTBEAT_MAX_AGE_MS || 120_000)))) throw new Error("worker heartbeat is stale");
    }
    return Response.json({ status: "ready", storage: config.storage, time: new Date().toISOString() }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
}

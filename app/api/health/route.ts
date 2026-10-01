export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: "ok", service: "vector-web", time: new Date().toISOString() }, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

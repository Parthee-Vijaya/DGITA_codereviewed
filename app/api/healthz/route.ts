export const dynamic = "force-dynamic";

/** Liveness only. Readiness and external integrations need separate checks. */
export async function GET() {
  return Response.json({ status: "ok" }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

import { ensurePortalSchema, getPersistenceBindings } from "../../../db/persistence";
import { deploymentStage, readRuntimeEnvironment } from "../../../features/runtime/environment";
import { productionConfigurationIssues } from "../../../features/runtime/production-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store, max-age=0" };
  try {
    const environment = await readRuntimeEnvironment();
    if (deploymentStage(environment) === "production" && productionConfigurationIssues(environment).length) {
      return Response.json({ status: "not_ready" }, { status: 503, headers });
    }
    await ensurePortalSchema();
    const { DB } = await getPersistenceBindings();
    await DB.prepare("SELECT 1 AS ok").first();
    return Response.json({ status: "ready" }, { headers });
  } catch {
    // Do not expose provider responses, credential values or database details.
    return Response.json({ status: "not_ready" }, { status: 503, headers });
  }
}

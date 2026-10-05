import { noStoreJson } from "../../../../features/auth/http";
import { runScheduledMaintenance } from "../../../../features/runtime/scheduled-maintenance";
import { getCronAuthorizationStatus } from "../../../../features/mail/cron-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = getCronAuthorizationStatus(
    request.headers.get("authorization"),
    process.env.CRON_SECRET,
  );

  if (authorization === "not_configured") {
    return noStoreJson(
      {
        code: "CRON_SECRET_NOT_CONFIGURED",
        error: "Mail-cronjobbet er ikke konfigureret.",
      },
      { status: 503 },
    );
  }

  if (authorization === "unauthorized") {
    return noStoreJson(
      { code: "CRON_UNAUTHORIZED", error: "Uautoriseret cron-kald." },
      {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      },
    );
  }

  const result = await runScheduledMaintenance();
  return noStoreJson(result, { status: result.alarm ? 503 : 200 });
}

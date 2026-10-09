import assert from "node:assert/strict";

function origin(value, label, protocol = "https:") {
  assert.equal(typeof value, "string", `Missing ${label}.`);
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`Invalid ${label}.`); }
  assert.ok(url.protocol === protocol && !url.username && !url.password && !url.port && !url.search && !url.hash && (url.pathname === "/" || url.pathname === ""), `Invalid ${label}.`);
  return url.hostname.toLowerCase();
}

/** Non-secret, operator-reviewed inventory; never infer isolation from a label. */
export function requirePreviewConfiguration(environment) {
  assert.equal(environment.DGITA_PREVIEW_ISOLATION_APPROVED, "true", "Review the preview resource inventory and scoped credentials before enabling preview.");
  let policy;
  try { policy = JSON.parse(environment.DGITA_PREVIEW_RESOURCE_POLICY ?? ""); }
  catch { throw new Error("Configure valid DGITA_PREVIEW_RESOURCE_POLICY JSON without secrets."); }
  assert.ok(policy && typeof policy === "object" && !Array.isArray(policy), "Missing preview resource inventory.");
  const inventories = ["preview", "pilot", "production"].map((name) => {
    const resource = policy[name];
    assert.ok(resource && typeof resource === "object", `Inventory must explicitly identify ${name} resources.`);
    assert.match(resource.projectId ?? "", /^prj_[\w-]+$/u, `Missing ${name} project identifier.`);
    assert.match(resource.blobStoreId ?? "", /^store_[A-Za-z0-9]+$/u, `Missing ${name} Blob store identifier.`);
    return { ...resource, databaseHost: origin(resource.databaseUrl, `${name} database`, "libsql:"), appHost: origin(resource.appOrigin, `${name} origin`) };
  });
  for (const key of ["projectId", "databaseHost", "blobStoreId", "appHost"]) {
    assert.equal(new Set(inventories.map((item) => item[key])).size, 3, `Preview, existing pilot and production must use different ${key} values.`);
  }
  assert.equal(environment.VERCEL_PROJECT_ID, inventories[0].projectId, "Preview must use its inventoried project.");
  return inventories[0];
}

export function requirePreviewApplicationEnvironment(environment, configuration, project) {
  const expected = requirePreviewConfiguration(environment);
  assert.ok(project?.projectId === expected.projectId && project?.orgId === environment.VERCEL_ORG_ID, "Pulled Vercel project/team does not match the approved preview.");
  assert.equal(origin(configuration.TURSO_DATABASE_URL, "preview database", "libsql:"), expected.databaseHost, "Preview database does not match the isolated inventory.");
  assert.equal(configuration.BLOB_STORE_ID, expected.blobStoreId, "Preview Blob store does not match the isolated inventory.");
  // A token takes precedence over BLOB_STORE_ID in persistence-runtime.ts.
  // Requiring project-scoped OIDC prevents a legacy token overriding the approved store.
  assert.ok(!configuration.BLOB_READ_WRITE_TOKEN, "Preview requires isolated Blob OIDC, not a reusable Blob token.");
  assert.equal(origin(configuration.DGITA_APP_ORIGIN, "preview origin"), expected.appHost, "Preview origin must not point at pilot or production.");
  assert.equal(origin(configuration.NEXT_PUBLIC_SITE_URL, "preview public origin"), expected.appHost, "Public preview links must not point at pilot or production.");
  assert.equal(configuration.DGITA_ENABLE_DEMO_SEED, "true", "Preview must explicitly use synthetic seed data.");
  assert.ok(!configuration.DGITA_MAIL_ALLOWED_RECIPIENTS?.trim(), "Preview email must remain blocked.");
  for (const key of Object.keys(configuration)) {
    if (/^DGITA_(?:GRAPH_|ENTRA_|FK_|MALWARE_SCAN_)/u.test(key) || key === "CRON_SECRET") {
      assert.ok(!configuration[key], `Remove external integration setting from isolated preview: ${key}`);
    }
  }
  return expected;
}

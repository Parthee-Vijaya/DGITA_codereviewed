import { LEGACY_DEMO_VIEWERS, SYNTHETIC_VIEWERS, type WorkspaceRole, type WorkspaceViewer } from "./model";

export type PilotProfile = "legacy-v1" | "synthetic-v1";
const TENANT_ID = "kalundborg";
const PROFILE_SCOPE = "test-fixture-profile";

function checkedProfile(value: string): PilotProfile {
  if (value === "legacy-v1" || value === "synthetic-v1") return value;
  throw new Error("Unknown test fixture profile; explicit operator review required.");
}

/** Called only after the existing test-login/seed environment gate. Never migrates user data. */
export async function resolvePilotProfile(DB: D1Database): Promise<PilotProfile> {
  const saved = await DB.prepare(`SELECT version FROM portal_bootstrap_state
    WHERE tenant_id = ? AND scope = ? LIMIT 1`).bind(TENANT_ID, PROFILE_SCOPE).first<{ version: string }>();
  if (saved) return checkedProfile(saved.version);

  const legacy = await DB.prepare(`SELECT id FROM portal_users WHERE tenant_id = ? AND identity_provider = 'dev'
    AND external_subject IN (?, ?, ?, ?, ?) LIMIT 1`).bind(TENANT_ID,
    ...Object.values(LEGACY_DEMO_VIEWERS).map((viewer) => viewer.subject),
    "kalundborg-user-anita-lauridsen", "kalundborg-consultant-peter-bjerre",
  ).first<{ id: string }>();
  const oldSeed = await DB.prepare(`SELECT version FROM portal_bootstrap_state
    WHERE tenant_id = ? AND scope = 'demo-defaults' LIMIT 1`).bind(TENANT_ID).first<{ version: string }>();
  const synthetic = await DB.prepare(`SELECT id FROM portal_users WHERE tenant_id = ? AND identity_provider = 'dev'
    AND external_subject IN (?, ?, ?) LIMIT 1`).bind(TENANT_ID,
    ...Object.values(SYNTHETIC_VIEWERS).map((viewer) => viewer.subject),
  ).first<{ id: string }>();
  if (legacy && synthetic) throw new Error("Mixed test fixture profiles; explicit operator review required.");
  const existing = await DB.prepare(`SELECT id FROM portal_users WHERE tenant_id = ? LIMIT 1`).bind(TENANT_ID).first<{ id: string }>();
  const existingApplication = await DB.prepare(`SELECT id FROM portal_applications WHERE tenant_id = ? LIMIT 1`).bind(TENANT_ID).first<{ id: string }>();
  if (!legacy && !oldSeed && !synthetic && (existing || existingApplication)) {
    throw new Error("Existing test data has no known profile; explicit operator review required.");
  }
  const selected: PilotProfile = legacy || (oldSeed && !synthetic) ? "legacy-v1" : "synthetic-v1";
  const now = new Date().toISOString();
  await DB.batch([
    DB.prepare(`INSERT OR IGNORE INTO portal_tenants
      (id, slug, name, authority_code, status, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 'active', ?, ?)`).bind(TENANT_ID, TENANT_ID, "Testkommune", now, now),
    DB.prepare(`INSERT OR IGNORE INTO portal_bootstrap_state (tenant_id, scope, version, completed_at)
      VALUES (?, ?, ?, ?)`).bind(TENANT_ID, PROFILE_SCOPE, selected, now),
  ]);
  const winner = await DB.prepare(`SELECT version FROM portal_bootstrap_state
    WHERE tenant_id = ? AND scope = ? LIMIT 1`).bind(TENANT_ID, PROFILE_SCOPE).first<{ version: string }>();
  if (!winner) throw new Error("Test fixture profile could not be persisted.");
  return checkedProfile(winner.version);
}

/** A returning test account keeps its stored name/mail and stable subject. */
export async function resolvePilotViewer(DB: D1Database, role: WorkspaceRole): Promise<WorkspaceViewer> {
  const profile = await resolvePilotProfile(DB);
  const template = (profile === "legacy-v1" ? LEGACY_DEMO_VIEWERS : SYNTHETIC_VIEWERS)[role];
  const stored = await DB.prepare(`SELECT users.email, users.display_name, tenants.name AS municipality
    FROM portal_users users JOIN portal_tenants tenants ON tenants.id = users.tenant_id
    WHERE users.tenant_id = ? AND users.identity_provider = 'dev' AND users.external_subject = ?
    LIMIT 1`).bind(template.tenantId, template.subject).first<{ email: string; display_name: string; municipality: string }>();
  if (stored) return { ...template, email: stored.email, displayName: stored.display_name, municipality: stored.municipality };
  if (profile === "legacy-v1") throw new Error("Historical test account is missing; automatic recreation is disabled.");
  return { ...template };
}

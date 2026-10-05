import {
  DEFAULT_CONTENT, DEFAULT_IMAGES, LEGACY_DEMO_CASES, LEGACY_DEMO_VIEWERS, EMPTY_D_GITA_APPROVAL,
  SYNTHETIC_VIEWERS, SYNTHETIC_EXTRA_USERS, SYNTHETIC_APPROVERS, SYNTHETIC_CASES,
  type CaseRecord, type DgitaApproval, type WorkspaceRole,
} from "./model";
import { LEGACY_APPROVING_LEADERS, legacyDemoApplicationState, initialApplicationState } from "../application/engine";
import { resolvePilotProfile, type PilotProfile } from "./pilot-profile";

const DEFAULT_APPROVALS: Record<string, DgitaApproval> = {
  "ITA-001284": {
    ...EMPTY_D_GITA_APPROVAL,
    approved: "Ja",
    date: "2026-08-26",
    legalBasis: "GDPR",
    responsible: "Peter Bjerre Ahlgren",
    hasAdditionalResponsible: "Nej",
    itConsultant: "Casper Kjeldsen Ravn",
    infrastructureChanges: "Ja",
    notes: "Arkitekturtegning skal eftersendes før endelig afslutning.",
    internalComments: "Afstem teknisk ejer med Infrastruktur på næste statusmøde.",
    phase: "Under behandling",
  },
};

const EXTRA_DEMO_USERS = [
  {
    id: "kalundborg-user-anita-lauridsen",
    email: "anita.lauridsen@kalundborg.dk",
    displayName: "Anita Mark Vig Lauridsen",
    role: "user" as const,
  },
  {
    id: "kalundborg-consultant-peter-bjerre",
    email: "peter.bjerre@kalundborg.dk",
    displayName: "Peter Bjerre Ahlgren",
    role: "consultant" as const,
  },
];

function fixturesFor(profile: PilotProfile) {
  return profile === "legacy-v1" ? {
    profile, viewers: LEGACY_DEMO_VIEWERS, cases: LEGACY_DEMO_CASES, extraUsers: EXTRA_DEMO_USERS,
    approvers: LEGACY_APPROVING_LEADERS, approvals: DEFAULT_APPROVALS,
  } : {
    profile, viewers: SYNTHETIC_VIEWERS, cases: SYNTHETIC_CASES, extraUsers: SYNTHETIC_EXTRA_USERS,
    approvers: SYNTHETIC_APPROVERS,
    approvals: { "ITA-001284": { ...DEFAULT_APPROVALS["ITA-001284"], responsible: "Testgodkender 01", itConsultant: "Testkonsulent 01" } },
  };
}

type PilotFixtures = ReturnType<typeof fixturesFor>;

function fixtureUserByName(fixtures: PilotFixtures, name: string) {
  const viewer = Object.values(fixtures.viewers).find((item) => item.displayName === name);
  if (viewer) return { id: viewer.subject, email: viewer.email };
  return fixtures.extraUsers.find((item) => item.displayName === name) ?? null;
}

export async function seedPortalDefaults(DB: D1Database) {
  const fixtures = fixturesFor(await resolvePilotProfile(DB));
  const now = "2026-08-26T12:00:00.000Z";
  const statements: D1PreparedStatement[] = [
    DB.prepare(`
      INSERT OR IGNORE INTO portal_tenants
        (id, slug, name, authority_code, status, created_at, updated_at)
      VALUES ('kalundborg', 'kalundborg', 'Kalundborg Kommune', '326', 'active', ?, ?)
    `).bind(now, now),
  ];

  for (const viewer of Object.values(fixtures.viewers)) {
    statements.push(...demoUserStatements(DB, viewer.subject, viewer.email, viewer.displayName, viewer.role, now));
  }
  for (const user of fixtures.extraUsers) {
    statements.push(...demoUserStatements(DB, user.id, user.email, user.displayName, user.role, now));
  }
  await runBatches(DB, statements);
  await runBatches(DB, fixtures.approvers.map((leader) => DB.prepare(`
    INSERT OR IGNORE INTO portal_user_roles
      (id, tenant_id, user_id, role, created_at, created_by_user_id)
    VALUES (?, 'kalundborg', ?, 'approver', ?, NULL)
  `).bind(`role:${leader.id}:approver`, leader.id, now)));
  await seedContentDefaults(DB, "kalundborg");
  await seedImageDefaults(DB, "kalundborg");
  await seedDemoApplications(DB, now, fixtures);
}

function demoUserStatements(
  DB: D1Database,
  id: string,
  email: string,
  displayName: string,
  role: WorkspaceRole,
  now: string,
) {
  const databaseRole = role === "consultant" ? "dgita_consultant" : role;
  return [
    DB.prepare(`
      INSERT OR IGNORE INTO portal_users
        (id, tenant_id, identity_provider, external_subject, email, display_name,
         status, created_at, updated_at, last_login_at)
      VALUES (?, 'kalundborg', 'dev', ?, ?, ?, 'active', ?, ?, NULL)
    `).bind(id, id, email, displayName, now, now),
    DB.prepare(`
      INSERT OR IGNORE INTO portal_user_roles
        (id, tenant_id, user_id, role, created_at, created_by_user_id)
      VALUES (?, 'kalundborg', ?, ?, ?, NULL)
    `).bind(`role:${id}:${databaseRole}`, id, databaseRole, now),
  ];
}

export async function seedContentDefaults(DB: D1Database, tenantId: string) {
  const now = "2026-08-26T12:00:00.000Z";
  const statements: D1PreparedStatement[] = [];
  for (const entry of DEFAULT_CONTENT) {
    statements.push(DB.prepare(`
      INSERT OR IGNORE INTO portal_content_entries
        (id, tenant_id, key, locale, page_path, content_type, value_json, status,
         version, updated_by_user_id, created_at, updated_at, published_at)
      VALUES (?, ?, ?, 'da-DK', ?, 'content', ?, ?, 1, NULL, ?, ?, ?)
    `).bind(
      `content:${tenantId}:${entry.id}`,
      tenantId,
      entry.id,
      entry.location,
      JSON.stringify(entry),
      entry.published ? "published" : "draft",
      now,
      now,
      entry.published ? now : null,
    ));
  }
  await runBatches(DB, statements);
}

export async function seedImageDefaults(DB: D1Database, tenantId: string) {
  const now = "2026-08-26T12:00:00.000Z";
  const statements: D1PreparedStatement[] = [];
  for (const entry of DEFAULT_IMAGES) {
    statements.push(DB.prepare(`
      INSERT OR IGNORE INTO portal_content_entries
        (id, tenant_id, key, locale, page_path, content_type, value_json, status,
         version, updated_by_user_id, created_at, updated_at, published_at)
      VALUES (?, ?, ?, 'da-DK', ?, 'image', ?, 'published', 1, NULL, ?, ?, ?)
    `).bind(
      `image:${tenantId}:${entry.id}`,
      tenantId,
      entry.id,
      entry.location,
      JSON.stringify(entry),
      now,
      now,
      now,
    ));
  }
  await runBatches(DB, statements);
}

async function seedDemoApplications(DB: D1Database, fallbackNow: string, fixtures: PilotFixtures) {
  const statements: D1PreparedStatement[] = [];
  for (const item of fixtures.cases) {
    const status = item.phase === "Kladde"
      ? "draft"
      : item.phase === "Indsendt"
        ? "submitted"
        : item.phase === "Under behandling"
          ? "under_review"
          : "closed";
    const versionId = status === "draft" ? null : `demo-version:${item.id}`;
    const versionNumber = versionId ? 1 : 0;
    const snapshotJson = JSON.stringify(demoSnapshotForCase(item, fixtures));
    const submittedAt = status === "draft" ? null : parseDemoDate(item.changed) ?? fallbackNow;
    const consultantId = fixtureUserByName(fixtures, item.consultant)?.id ?? null;
    statements.push(DB.prepare(`
      INSERT OR IGNORE INTO portal_applications
        (id, tenant_id, owner_user_id, case_number, title, system_name, status,
         phase, assigned_consultant_user_id, draft_schema_version, draft_state_json,
         row_version, current_version_number, current_version_id, created_at,
         updated_at, submitted_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'dgita-v1', ?, 1, ?, ?, ?, ?, ?, ?)
    `).bind(
      `demo:${item.id}`,
      item.tenantId,
      item.ownerSubject,
      item.id,
      item.system,
      item.system,
      status,
      item.phase,
      consultantId,
      snapshotJson,
      versionNumber,
      versionId,
      parseDemoDate(item.created) ?? fallbackNow,
      parseDemoDate(item.changed) ?? fallbackNow,
      submittedAt,
      status === "closed" ? parseDemoDate(item.changed) ?? fallbackNow : null,
    ));
    statements.push(DB.prepare(`
      UPDATE portal_applications
      SET status = ?, phase = ?, draft_schema_version = 'dgita-v1',
          draft_state_json = ?,
          current_version_number = ?, current_version_id = ?,
          submitted_at = CASE WHEN ? = 0 THEN NULL ELSE COALESCE(submitted_at, ?) END,
          closed_at = CASE WHEN ? = 'closed' THEN COALESCE(closed_at, ?) ELSE NULL END
      WHERE id = ? AND tenant_id = ? AND row_version = 1
        AND current_version_number <= 1
        AND (current_version_id IS NULL OR current_version_id IS ?)
        AND NOT EXISTS (
          SELECT 1 FROM portal_application_versions existing_version
          WHERE existing_version.tenant_id = portal_applications.tenant_id
            AND existing_version.application_id = portal_applications.id
            AND existing_version.version_number > 1
        )
    `).bind(
      status,
      item.phase,
      snapshotJson,
      versionNumber,
      versionId,
      versionNumber,
      submittedAt,
      status,
      parseDemoDate(item.changed) ?? fallbackNow,
      `demo:${item.id}`,
      item.tenantId,
      versionId,
    ));
    if (versionId && submittedAt) {
      statements.push(DB.prepare(`
        INSERT OR IGNORE INTO portal_application_versions
          (id, tenant_id, application_id, version_number, schema_version,
           snapshot_json, snapshot_sha256, attachment_manifest_sha256,
           submitted_by_user_id, created_at, submitted_at)
        VALUES (?, ?, ?, 1, 'dgita-v1', ?, ?, ?, ?, ?, ?)
      `).bind(
        versionId,
        item.tenantId,
        `demo:${item.id}`,
        snapshotJson,
        await sha256Text(snapshotJson),
        await sha256Text("[]"),
        item.ownerSubject,
        submittedAt,
        submittedAt,
      ));
      if (item.approval !== "Ikke startet") {
        const approvalStatus = item.approval === "Godkendt"
          ? "approved"
          : item.approval === "Afvist"
            ? "rejected"
            : "pending";
        const seedRequestId = `demo-approval-request:${item.id}`;
        const seedTokenHash = `demo-token-hash:${item.id}`;
        if (approvalStatus === "pending") {
          statements.push(DB.prepare(`
            DELETE FROM portal_approval_requests
            WHERE id = ? AND tenant_id = ? AND application_id = ?
              AND application_version_id = ? AND status = 'pending'
              AND token_hash = ?
          `).bind(
            seedRequestId,
            item.tenantId,
            `demo:${item.id}`,
            versionId,
            seedTokenHash,
          ));
        } else {
          statements.push(DB.prepare(`
            INSERT OR IGNORE INTO portal_approval_requests
              (id, tenant_id, application_id, application_version_id,
               approver_email, approver_name, token_hash, status, decision_comment,
               created_by_user_id, created_at, expires_at, decided_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            seedRequestId,
            item.tenantId,
            `demo:${item.id}`,
            versionId,
            fixtureUserByName(fixtures, item.leader)?.email ?? "leader@example.invalid",
            item.leader,
            seedTokenHash,
            approvalStatus,
            approvalStatus === "approved" ? "Godkendt i testdata" : "Afvist i testdata",
            fixtures.viewers.consultant.subject,
            submittedAt,
            submittedAt,
            submittedAt,
          ));
        }
      }
    }
  }
  await runBatches(DB, statements);
  await DB.batch([
    DB.prepare(`
      UPDATE portal_approval_requests
      SET decision_comment = CASE decision_comment
        WHEN 'Godkendt i demonstrationsdata' THEN 'Godkendt i testdata'
        WHEN 'Afvist i demonstrationsdata' THEN 'Afvist i testdata'
        ELSE decision_comment
      END
      WHERE tenant_id = 'kalundborg'
        AND token_hash LIKE 'demo-token-hash:%'
        AND decision_comment IN (
          'Godkendt i demonstrationsdata',
          'Afvist i demonstrationsdata'
        )
    `),
    DB.prepare(`
      UPDATE portal_approval_requests
      SET approver_email = 'test-leder@kalundborg.dk'
      WHERE tenant_id = 'kalundborg'
        AND token_hash LIKE 'demo-token-hash:%'
        AND approver_email = 'demo-leder@kalundborg.dk'
    `),
  ]);

  for (const [caseNumber, approval] of Object.entries(fixtures.approvals)) {
    const application = await DB.prepare(
      "SELECT id FROM portal_applications WHERE tenant_id = 'kalundborg' AND case_number = ? LIMIT 1",
    ).bind(caseNumber).first<{ id: string }>();
    if (!application) continue;
    const approvalId = `approval:kalundborg:${application.id}`;
    const versionId = `demo-version:${caseNumber}`;
    await DB.batch([
      DB.prepare(`
        INSERT OR IGNORE INTO portal_dgita_approvals
          (id, tenant_id, application_id, application_version_id, reviewer_user_id,
           status, internal_fields_json, decision_comment, created_at, updated_at, decided_at)
        VALUES (?, 'kalundborg', ?, ?, ?, 'approved', ?, ?, ?, ?, ?)
      `).bind(
        approvalId,
        application.id,
        versionId,
        fixtures.extraUsers[1].id,
        JSON.stringify(approval),
        approval.notes,
        fallbackNow,
        fallbackNow,
        fallbackNow,
      ),
      DB.prepare(`
        UPDATE portal_dgita_approvals
        SET application_version_id = ?
        WHERE id = ? AND tenant_id = 'kalundborg' AND application_id = ?
          AND application_version_id IS NULL
          AND EXISTS (
            SELECT 1 FROM portal_applications application
            WHERE application.id = ? AND application.tenant_id = 'kalundborg'
              AND application.current_version_number = 1
              AND application.current_version_id = ?
          )
      `).bind(
        versionId,
        approvalId,
        application.id,
        application.id,
        versionId,
      ),
    ]);
  }
}

async function runBatches(DB: D1Database, statements: D1PreparedStatement[]) {
  for (let start = 0; start < statements.length; start += 40) {
    await DB.batch(statements.slice(start, start + 40));
  }
}

function parseDemoDate(value: string) {
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;
}

function demoSnapshotForCase(item: CaseRecord, fixtures: PilotFixtures) {
  const leader = fixtures.approvers.find((candidate) => candidate.name === item.leader);
  return {
    ...structuredClone(fixtures.profile === "legacy-v1" ? legacyDemoApplicationState : {
      ...initialApplicationState, purpose: "Afprøvning med syntetiske testsager.",
      dataOwner: "data-owner@example.invalid", systemOwner: "system-owner@example.invalid",
      contractOwner: "contract-owner@example.invalid", department: "Testafdeling",
    }),
    knownSystem: "nej" as const,
    catalogQuery: "",
    selectedSystem: null,
    manualCatalogEntry: true,
    manualSystemName: item.system,
    systemDescription: `Fiktivt beslutningsgrundlag for ${item.system}.`,
    contactPerson: item.applicant,
    approvingLeaderId: leader?.id ?? "",
    approvingLeader: leader?.name ?? "",
    _demo: { leader: item.leader, approval: item.approval },
  };
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

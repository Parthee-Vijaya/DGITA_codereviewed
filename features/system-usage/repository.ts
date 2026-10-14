import type { ServerActor } from "../auth/types";
import { ApplicationRepositoryError, portalDb } from "../application/repository-support";
import { evaluateKleReview, getKleConfirmationBinding, isKleReview, type KleReview } from "../kle/domain";
import { SYNTHETIC_KLE_CATALOG, SYNTHETIC_KL_TASK_CATALOG } from "../kle/synthetic";

/** Personal synthetic registrations; recording a usage does not confer an owner mandate. */
export type SystemUsage = {
  id: string;
  name: string;
  source: "synthetic";
  rowVersion: number;
  review: KleReview;
  createdAt: string;
  updatedAt: string;
};

export type SystemUsageRevision = {
  id: string;
  usageId: string;
  rowVersion: number;
  name: string;
  review: KleReview;
  eventType: "saved" | "confirmed";
  createdAt: string;
};

type UsageRow = {
  id: string;
  name: string;
  source: "synthetic";
  row_version: number;
  review_json: string;
  created_at: string;
  updated_at: string;
};
type RevisionRow = Omit<UsageRow, "source" | "updated_at"> & {
  usage_id: string;
  event_type: "saved" | "confirmed";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CATALOG = SYNTHETIC_KLE_CATALOG;
const TASKS = SYNTHETIC_KL_TASK_CATALOG;
const ACTIVE_ACTOR_SQL = `EXISTS (
  SELECT 1 FROM portal_users person
  JOIN portal_tenants tenant ON tenant.id = person.tenant_id AND tenant.status = 'active'
  WHERE person.id = ? AND person.tenant_id = ? AND person.external_subject = ?
    AND person.status = 'active' AND person.identity_provider = 'dev'
    AND EXISTS (SELECT 1 FROM portal_user_roles role
      WHERE role.user_id = person.id AND role.tenant_id = person.tenant_id
        AND role.role IN ('user', 'dgita_consultant', 'admin'))
)`;

const actorBindings = (actor: ServerActor) => [actor.userId, actor.tenantId, actor.subject];

async function activeDb(actor: ServerActor) {
  if (actor.provider !== "dev") {
    throw new ApplicationRepositoryError(403, "Afprøvningen kræver en lokal testbruger.");
  }
  const DB = await portalDb();
  if (!await DB.prepare(`SELECT 1 AS eligible WHERE ${ACTIVE_ACTOR_SQL}`).bind(...actorBindings(actor)).first()) {
    throw new ApplicationRepositoryError(403, "Testbrugeren har ikke længere adgang til afprøvningen.");
  }
  return DB;
}

function assertId(id: string) {
  if (typeof id !== "string" || !UUID.test(id)) throw new ApplicationRepositoryError(400, "Ugyldig systemanvendelse.");
}

function parseReview(value: string): KleReview {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { /* Fail closed for a corrupt stored snapshot. */ }
  if (!isKleReview(parsed)) throw new ApplicationRepositoryError(409, "Den gemte registrering kunne ikke læses. Genindlæs siden.");
  return parsed;
}

function toUsage(row: UsageRow): SystemUsage {
  return { id: row.id, name: row.name, source: row.source, rowVersion: row.row_version,
    review: parseReview(row.review_json), createdAt: row.created_at, updatedAt: row.updated_at };
}

function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationRepositoryError(400, "Registreringen skal være et gyldigt objekt.");
  }
  return value as Record<string, unknown>;
}

function fields(value: unknown) {
  const input = inputObject(value);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 200 || /[\u0000-\u001f\u007f]/u.test(input.name)) {
    throw new ApplicationRepositoryError(422, "Angiv et navn på højst 200 tegn uden kontroltegn.");
  }
  // Validate even discarded metadata so malformed client input cannot evade the bounds.
  if (!isKleReview(input.review)) throw new ApplicationRepositoryError(422, "KLE-registreringen har et ugyldigt format.");
  const review = structuredClone(input.review);
  delete review.confirmation;
  return { input, name: input.name.trim(), review };
}

async function ownedUsage(DB: D1Database, actor: ServerActor, id: string): Promise<UsageRow> {
  const row = await DB.prepare(`SELECT id, name, source, row_version, review_json, created_at, updated_at
    FROM portal_system_usages
    WHERE id = ? AND tenant_id = ? AND recorded_by_user_id = ? AND source = 'synthetic'
      AND ${ACTIVE_ACTOR_SQL}`)
    .bind(id, actor.tenantId, actor.userId, ...actorBindings(actor)).first<UsageRow>();
  if (!row) throw new ApplicationRepositoryError(404, "Registreringen findes ikke, eller du har ikke adgang.");
  return row;
}

export async function listSystemUsages(actor: ServerActor): Promise<SystemUsage[]> {
  const DB = await activeDb(actor);
  const rows = await DB.prepare(`SELECT id, name, source, row_version, review_json, created_at, updated_at
    FROM portal_system_usages
    WHERE tenant_id = ? AND recorded_by_user_id = ? AND source = 'synthetic' AND ${ACTIVE_ACTOR_SQL}
    ORDER BY updated_at DESC, id LIMIT 100`)
    .bind(actor.tenantId, actor.userId, ...actorBindings(actor)).all<UsageRow>();
  return rows.results.map(toUsage);
}

export async function getSystemUsage(actor: ServerActor, id: string): Promise<SystemUsage> {
  assertId(id);
  return toUsage(await ownedUsage(await activeDb(actor), actor, id));
}

export async function listSystemUsageRevisions(actor: ServerActor, id: string): Promise<SystemUsageRevision[]> {
  assertId(id);
  const DB = await activeDb(actor);
  await ownedUsage(DB, actor, id);
  const rows = await DB.prepare(`SELECT id, usage_id, row_version, name, review_json, event_type, created_at
    FROM portal_system_usage_revisions
    WHERE usage_id = ? AND tenant_id = ? AND recorded_by_user_id = ? AND ${ACTIVE_ACTOR_SQL}
    ORDER BY row_version DESC LIMIT 50`)
    .bind(id, actor.tenantId, actor.userId, ...actorBindings(actor)).all<RevisionRow>();
  return rows.results.map((row) => ({ id: row.id, usageId: row.usage_id, rowVersion: row.row_version,
    name: row.name, review: parseReview(row.review_json), eventType: row.event_type, createdAt: row.created_at }));
}

/** The history insert is conditional on the preceding write in the same atomic batch. */
function revisionStatement(DB: D1Database, actor: ServerActor, id: string, rowVersion: number,
  name: string, reviewJson: string, eventType: "saved" | "confirmed", now: string) {
  return DB.prepare(`INSERT INTO portal_system_usage_revisions
    (id, tenant_id, usage_id, row_version, recorded_by_user_id, name, review_json, event_type, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
    .bind(crypto.randomUUID(), actor.tenantId, id, rowVersion, actor.userId, name, reviewJson, eventType, now);
}

function assertWritten(results: D1Result[]) {
  if (Number(results[0]?.meta.changes ?? 0) !== 1 || Number(results[1]?.meta.changes ?? 0) !== 1) {
    throw new ApplicationRepositoryError(409, "Registreringen blev ændret samtidig, eller adgangen er ændret. Hent den nyeste version før du gemmer.");
  }
}

/** Compare values rather than client object-key order; no fields are inferred or discarded. */
function initialReviewSnapshot(review: KleReview) {
  return JSON.stringify({
    schemaVersion: review.schemaVersion,
    selectedCodes: review.selectedCodes.map(({ uuid, code }) => ({ uuid, code })),
    localTaskDescription: review.localTaskDescription,
    legacyTopics: review.legacyTopics,
    localAssessment: review.localAssessment ? {
      level: review.localAssessment.level,
      rationale: review.localAssessment.rationale,
      inputBinding: review.localAssessment.inputBinding,
    } : null,
  });
}

export async function createSystemUsage(actor: ServerActor, value: unknown): Promise<SystemUsage> {
  const DB = await activeDb(actor);
  const { input, name, review } = fields(value);
  const id = input.id as string;
  assertId(id);
  const now = new Date().toISOString();
  const reviewJson = JSON.stringify(review);
  const results = await DB.batch([
    DB.prepare(`INSERT INTO portal_system_usages
      (id, tenant_id, recorded_by_user_id, name, source, row_version, review_json, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'synthetic', 1, ?, ?, ? WHERE ${ACTIVE_ACTOR_SQL}
      ON CONFLICT (id) DO NOTHING`)
      .bind(id, actor.tenantId, actor.userId, name, reviewJson, now, now, ...actorBindings(actor)),
    revisionStatement(DB, actor, id, 1, name, reviewJson, "saved", now),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0 && Number(results[1]?.meta.changes ?? 0) === 0) {
    // The browser keeps its creation ID after a lost response. Match only the
    // immutable first snapshot; a retry must never reset later saved changes.
    const current = await ownedUsage(DB, actor, id);
    const initial = await DB.prepare(`SELECT name, review_json FROM portal_system_usage_revisions
      WHERE usage_id = ? AND tenant_id = ? AND recorded_by_user_id = ? AND row_version = 1`)
      .bind(id, actor.tenantId, actor.userId).first<{ name: string; review_json: string }>();
    if (!initial || initial.name !== name || initialReviewSnapshot(parseReview(initial.review_json)) !== initialReviewSnapshot(review)) {
      throw new ApplicationRepositoryError(409, "Registreringen er allerede oprettet med andre oplysninger. Hent den gemte version før du fortsætter.");
    }
    return toUsage(current);
  }
  assertWritten(results);
  return { id, name, source: "synthetic", rowVersion: 1, review, createdAt: now, updatedAt: now };
}

export async function saveSystemUsage(actor: ServerActor, id: string, value: unknown): Promise<SystemUsage> {
  assertId(id);
  const DB = await activeDb(actor);
  const stored = await ownedUsage(DB, actor, id);
  const { input, name, review } = fields(value);
  if (!Number.isSafeInteger(input.expectedRowVersion) || input.expectedRowVersion !== stored.row_version) {
    throw new ApplicationRepositoryError(409, "Registreringen er ændret. Hent den nyeste version før du gemmer.");
  }
  if (input.confirm !== undefined && typeof input.confirm !== "boolean") {
    throw new ApplicationRepositoryError(422, "Bekræftelse skal være et gyldigt valg.");
  }
  const previous = parseReview(stored.review_json);
  const now = new Date().toISOString();
  if (input.confirm === true) {
    const evaluation = evaluateKleReview(review, CATALOG, TASKS);
    if (evaluation.state === "incomplete" || !evaluation.assessmentCurrent) {
      throw new ApplicationRepositoryError(422, "Afklar opgaverne og gem en lokal vurdering af det aktuelle grundlag før du bekræfter.", evaluation.issues);
    }
    review.confirmation = { inputBinding: getKleConfirmationBinding(review, CATALOG, TASKS), confirmedBy: actor.userId, confirmedAt: now };
  } else if (name === stored.name && previous.confirmation && evaluateKleReview(previous, CATALOG, TASKS).confirmationCurrent
    && previous.confirmation.inputBinding === getKleConfirmationBinding(review, CATALOG, TASKS)) {
    review.confirmation = previous.confirmation;
  }
  // Server-generated metadata must meet the same bounds as snapshots on read.
  if (!isKleReview(review)) {
    throw new ApplicationRepositoryError(422, "Bekræftelsen kunne ikke gemmes i et gyldigt format. Registreringen er ikke ændret.");
  }
  const rowVersion = stored.row_version + 1;
  const reviewJson = JSON.stringify(review);
  const eventType = input.confirm === true ? "confirmed" : "saved";
  const results = await DB.batch([
    DB.prepare(`UPDATE portal_system_usages SET name = ?, review_json = ?, updated_at = ?, row_version = row_version + 1
      WHERE id = ? AND tenant_id = ? AND recorded_by_user_id = ? AND source = 'synthetic'
        AND row_version = ? AND ${ACTIVE_ACTOR_SQL}`)
      .bind(name, reviewJson, now, id, actor.tenantId, actor.userId, stored.row_version, ...actorBindings(actor)),
    revisionStatement(DB, actor, id, rowVersion, name, reviewJson, eventType, now),
  ]);
  assertWritten(results);
  return { id, name, source: "synthetic", rowVersion, review, createdAt: stored.created_at, updatedAt: now };
}

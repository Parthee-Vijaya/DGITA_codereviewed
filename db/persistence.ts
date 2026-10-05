import type {
  ApplicationFormState,
  AttachmentDraft,
  UploadKind,
} from "../features/application/engine";

export type DraftRow = {
  id: string;
  state_json: string;
  status: "draft" | "submitted";
  updated_at: string;
};

export type AttachmentRow = {
  id: string;
  draft_id: string;
  kind: UploadKind;
  name: string;
  size: number;
  content_type: string;
  storage_key: string;
};

export type PersistenceBindings = {
  DB: D1Database;
  FILES: R2Bucket;
};

const legacySchemaStatements = [
  `CREATE TABLE IF NOT EXISTS application_drafts (
    id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    state_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    submitted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS application_attachments (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    FOREIGN KEY (draft_id) REFERENCES application_drafts(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS application_drafts_status_idx ON application_drafts(status)",
  "CREATE INDEX IF NOT EXISTS application_attachments_draft_idx ON application_attachments(draft_id)",
] as const;

/**
 * Canonical portal schema. Every entry is exactly one SQLite statement so D1
 * can safely prepare and batch it. Drizzle migrations remain the deployment
 * source of truth; this idempotent bootstrap supports fresh local/Sites DBs.
 */
export const portalSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS portal_environment (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    purpose TEXT NOT NULL CHECK (purpose IN ('test', 'production'))
  )`,
  `CREATE TABLE IF NOT EXISTS portal_oidc_used_states (
    state_hash TEXT PRIMARY KEY NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS portal_oidc_used_states_expires_idx
    ON portal_oidc_used_states(expires_at)`,
  `CREATE TABLE IF NOT EXISTS portal_tenants (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    authority_code TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS portal_tenants_slug_uidx ON portal_tenants(slug)",
  "CREATE INDEX IF NOT EXISTS portal_tenants_status_idx ON portal_tenants(status)",

  `CREATE TABLE IF NOT EXISTS portal_bootstrap_state (
    tenant_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    version TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, scope),
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS portal_users (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    identity_provider TEXT NOT NULL,
    external_subject TEXT NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_users_tenant_provider_subject_uidx
    ON portal_users(tenant_id, identity_provider, external_subject)`,
  "CREATE INDEX IF NOT EXISTS portal_users_tenant_email_idx ON portal_users(tenant_id, email)",
  "CREATE INDEX IF NOT EXISTS portal_users_tenant_status_idx ON portal_users(tenant_id, status)",

  `CREATE TABLE IF NOT EXISTS portal_user_roles (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_user_id TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES portal_users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_user_roles_tenant_user_role_uidx
    ON portal_user_roles(tenant_id, user_id, role)`,
  "CREATE INDEX IF NOT EXISTS portal_user_roles_tenant_role_idx ON portal_user_roles(tenant_id, role)",

  `CREATE TABLE IF NOT EXISTS portal_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_session_id TEXT,
    roles_snapshot_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT,
    ip_hash TEXT,
    user_agent_hash TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES portal_users(id) ON DELETE CASCADE
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS portal_sessions_token_hash_uidx ON portal_sessions(token_hash)",
  `CREATE INDEX IF NOT EXISTS portal_sessions_user_active_idx
    ON portal_sessions(tenant_id, user_id, revoked_at, expires_at)`,
  "CREATE INDEX IF NOT EXISTS portal_sessions_expiry_idx ON portal_sessions(expires_at)",

  `CREATE TABLE IF NOT EXISTS portal_auth_rate_limits (
    scope TEXT NOT NULL,
    subject_hash TEXT NOT NULL,
    window_started_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope, subject_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS portal_auth_rate_limits_updated_idx
    ON portal_auth_rate_limits(updated_at)`,

  `CREATE TABLE IF NOT EXISTS portal_applications (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    case_number TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Ny ansøgning',
    system_name TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    phase TEXT NOT NULL DEFAULT 'draft',
    assigned_consultant_user_id TEXT,
    draft_schema_version TEXT NOT NULL,
    draft_state_json TEXT NOT NULL,
    row_version INTEGER NOT NULL DEFAULT 1,
    current_version_number INTEGER NOT NULL DEFAULT 0,
    current_version_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at TEXT,
    closed_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT,
    FOREIGN KEY (assigned_consultant_user_id) REFERENCES portal_users(id) ON DELETE SET NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_applications_tenant_case_uidx
    ON portal_applications(tenant_id, case_number)`,
  `CREATE INDEX IF NOT EXISTS portal_applications_owner_status_idx
    ON portal_applications(tenant_id, owner_user_id, status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS portal_applications_queue_idx
    ON portal_applications(tenant_id, status, phase, updated_at)`,
  `CREATE INDEX IF NOT EXISTS portal_applications_assignee_idx
    ON portal_applications(tenant_id, assigned_consultant_user_id, status)`,

  `CREATE TABLE IF NOT EXISTS portal_application_versions (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    snapshot_sha256 TEXT NOT NULL,
    attachment_manifest_sha256 TEXT,
    submitted_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id) REFERENCES portal_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (submitted_by_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_application_versions_application_number_uidx
    ON portal_application_versions(application_id, version_number)`,
  `CREATE INDEX IF NOT EXISTS portal_application_versions_tenant_application_idx
    ON portal_application_versions(tenant_id, application_id, submitted_at)`,

  `CREATE TABLE IF NOT EXISTS portal_attachments (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    application_version_id TEXT,
    owner_user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    scan_status TEXT NOT NULL DEFAULT 'pending',
    uploaded_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    immutable_at TEXT,
    deleted_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id) REFERENCES portal_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_version_id) REFERENCES portal_application_versions(id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT,
    FOREIGN KEY (uploaded_by_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS portal_attachments_storage_key_uidx ON portal_attachments(storage_key)",
  `CREATE INDEX IF NOT EXISTS portal_attachments_owner_idx
    ON portal_attachments(tenant_id, owner_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS portal_attachments_application_idx
    ON portal_attachments(tenant_id, application_id, created_at)`,
  "CREATE INDEX IF NOT EXISTS portal_attachments_version_idx ON portal_attachments(application_version_id)",

  `CREATE TABLE IF NOT EXISTS portal_attachment_upload_locks (
    attachment_id TEXT PRIMARY KEY NOT NULL,
    authoritative_storage_key TEXT NOT NULL,
    lease_token TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (attachment_id) REFERENCES portal_attachments(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_attachment_upload_locks_storage_key_uidx
    ON portal_attachment_upload_locks(authoritative_storage_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_attachment_upload_locks_token_uidx
    ON portal_attachment_upload_locks(lease_token)`,
  `CREATE INDEX IF NOT EXISTS portal_attachment_upload_locks_expiry_idx
    ON portal_attachment_upload_locks(expires_at)`,

  `CREATE TABLE IF NOT EXISTS portal_content_entries (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    locale TEXT NOT NULL DEFAULT 'da-DK',
    page_path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    value_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    version INTEGER NOT NULL DEFAULT 1,
    updated_by_user_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_content_entries_tenant_key_locale_uidx
    ON portal_content_entries(tenant_id, key, locale)`,
  `CREATE INDEX IF NOT EXISTS portal_content_entries_page_status_idx
    ON portal_content_entries(tenant_id, page_path, status)`,

  `CREATE TABLE IF NOT EXISTS portal_images (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    content_entry_id TEXT,
    storage_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    alt_text TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    uploaded_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (content_entry_id) REFERENCES portal_content_entries(id) ON DELETE SET NULL,
    FOREIGN KEY (uploaded_by_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS portal_images_storage_key_uidx ON portal_images(storage_key)",
  "CREATE INDEX IF NOT EXISTS portal_images_tenant_status_idx ON portal_images(tenant_id, status)",
  "CREATE INDEX IF NOT EXISTS portal_images_content_entry_idx ON portal_images(content_entry_id)",

  `CREATE TABLE IF NOT EXISTS portal_dgita_approvals (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    application_version_id TEXT,
    reviewer_user_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    internal_fields_json TEXT NOT NULL DEFAULT '{}',
    decision_comment TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id) REFERENCES portal_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_version_id) REFERENCES portal_application_versions(id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewer_user_id) REFERENCES portal_users(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS portal_dgita_approvals_queue_idx
    ON portal_dgita_approvals(tenant_id, status, updated_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_dgita_approvals_tenant_application_uidx
    ON portal_dgita_approvals(tenant_id, application_id)`,
  `CREATE INDEX IF NOT EXISTS portal_dgita_approvals_application_idx
    ON portal_dgita_approvals(tenant_id, application_id, application_version_id)`,

  `CREATE TABLE IF NOT EXISTS portal_field_comments (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    application_version_id TEXT,
    field_id TEXT NOT NULL,
    author_user_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'applicant',
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    parent_comment_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    edited_at TEXT,
    resolved_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id) REFERENCES portal_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_version_id) REFERENCES portal_application_versions(id) ON DELETE RESTRICT,
    FOREIGN KEY (author_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS portal_field_comments_field_idx
    ON portal_field_comments(tenant_id, application_id, field_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS portal_field_comments_visibility_idx
    ON portal_field_comments(tenant_id, application_id, visibility)`,

  `CREATE TABLE IF NOT EXISTS portal_case_comments (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    application_version_id TEXT,
    author_user_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'shared',
    category TEXT NOT NULL DEFAULT 'comment',
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    parent_comment_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    edited_at TEXT,
    resolved_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id) REFERENCES portal_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_version_id) REFERENCES portal_application_versions(id) ON DELETE RESTRICT,
    FOREIGN KEY (author_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS portal_case_comments_case_idx
    ON portal_case_comments(tenant_id, application_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS portal_case_comments_visibility_idx
    ON portal_case_comments(tenant_id, application_id, visibility)`,

  `CREATE TABLE IF NOT EXISTS portal_audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    application_id TEXT,
    actor_user_id TEXT,
    actor_subject TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    ip_hash TEXT,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id) REFERENCES portal_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS portal_audit_events_application_idx
    ON portal_audit_events(tenant_id, application_id, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS portal_audit_events_entity_idx
    ON portal_audit_events(tenant_id, entity_type, entity_id, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS portal_audit_events_actor_idx
    ON portal_audit_events(tenant_id, actor_user_id, occurred_at)`,

  `CREATE TABLE IF NOT EXISTS portal_notifications (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    recipient_user_id TEXT NOT NULL,
    application_id TEXT,
    source_event_id TEXT,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link_path TEXT,
    status TEXT NOT NULL DEFAULT 'unread',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (recipient_user_id) REFERENCES portal_users(id) ON DELETE CASCADE,
    FOREIGN KEY (application_id) REFERENCES portal_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (source_event_id) REFERENCES portal_audit_events(id) ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_notifications_recipient_event_uidx
    ON portal_notifications(recipient_user_id, source_event_id)`,
  `CREATE INDEX IF NOT EXISTS portal_notifications_recipient_status_idx
    ON portal_notifications(tenant_id, recipient_user_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS portal_notifications_application_idx
    ON portal_notifications(tenant_id, application_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS portal_receipts (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    application_version_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'generating',
    storage_key TEXT NOT NULL,
    checksum_sha256 TEXT,
    size_bytes INTEGER,
    content_type TEXT NOT NULL DEFAULT 'application/pdf',
    created_by_user_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    generated_at TEXT,
    failure_reason TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id) REFERENCES portal_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_version_id) REFERENCES portal_application_versions(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_receipts_version_kind_uidx
    ON portal_receipts(tenant_id, application_version_id, kind)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS portal_receipts_storage_key_uidx ON portal_receipts(storage_key)",
  `CREATE INDEX IF NOT EXISTS portal_receipts_application_idx
    ON portal_receipts(tenant_id, application_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS portal_mail_outbox (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    application_id TEXT,
    recipient_user_id TEXT,
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,
    template_key TEXT NOT NULL,
    subject TEXT NOT NULL,
    text_body TEXT NOT NULL,
    html_body TEXT NOT NULL,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    provider TEXT NOT NULL DEFAULT 'microsoft_graph',
    provider_message_id TEXT,
    last_error TEXT,
    created_by_user_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id) REFERENCES portal_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (recipient_user_id) REFERENCES portal_users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_mail_outbox_tenant_idempotency_uidx
    ON portal_mail_outbox(tenant_id, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS portal_mail_outbox_queue_idx
    ON portal_mail_outbox(tenant_id, status, next_attempt_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS portal_mail_outbox_application_idx
    ON portal_mail_outbox(tenant_id, application_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS portal_approval_requests (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    application_version_id TEXT NOT NULL,
    approver_email TEXT NOT NULL,
    approver_name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    decision_comment TEXT,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    decided_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES portal_tenants(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id) REFERENCES portal_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (application_version_id) REFERENCES portal_application_versions(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by_user_id) REFERENCES portal_users(id) ON DELETE RESTRICT
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS portal_approval_requests_token_hash_uidx ON portal_approval_requests(token_hash)",
  `CREATE INDEX IF NOT EXISTS portal_approval_requests_application_idx
    ON portal_approval_requests(tenant_id, application_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS portal_approval_requests_expiry_idx
    ON portal_approval_requests(status, expires_at)`,

  `CREATE TRIGGER IF NOT EXISTS portal_application_versions_no_update
    BEFORE UPDATE ON portal_application_versions
    BEGIN SELECT RAISE(ABORT, 'submitted application versions are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS portal_application_versions_no_delete
    BEFORE DELETE ON portal_application_versions
    BEGIN SELECT RAISE(ABORT, 'submitted application versions are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS portal_versioned_attachments_no_update
    BEFORE UPDATE ON portal_attachments
    WHEN OLD.application_version_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'versioned attachments are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS portal_versioned_attachments_no_delete
    BEFORE DELETE ON portal_attachments
    WHEN OLD.application_version_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'versioned attachments are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS portal_attachment_upload_locks_insert_guard
    BEFORE INSERT ON portal_attachment_upload_locks
    WHEN NOT EXISTS (
      SELECT 1 FROM portal_attachments
      WHERE id = NEW.attachment_id AND application_version_id IS NULL
        AND status IN ('pending', 'verifying')
    )
    BEGIN SELECT RAISE(ABORT, 'upload locks require a mutable pending attachment'); END`,
  `CREATE TRIGGER IF NOT EXISTS portal_attachment_upload_locks_update_guard
    BEFORE UPDATE ON portal_attachment_upload_locks
    WHEN NOT EXISTS (
      SELECT 1 FROM portal_attachments
      WHERE id = NEW.attachment_id AND application_version_id IS NULL
        AND status IN ('pending', 'verifying')
    )
    BEGIN SELECT RAISE(ABORT, 'upload locks require a mutable pending attachment'); END`,
  `CREATE TRIGGER IF NOT EXISTS portal_audit_events_no_update
    BEFORE UPDATE ON portal_audit_events
    BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS portal_audit_events_no_delete
    BEFORE DELETE ON portal_audit_events
    BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END`,
] as const;

let legacySchemaPromise: Promise<void> | null = null;
let portalSchemaPromise: Promise<void> | null = null;
let vercelBindingsPromise: Promise<PersistenceBindings> | null = null;

export class PersistenceUnavailableError extends Error {
  readonly code = "PERSISTENCE_UNAVAILABLE";

  constructor() {
    super("Kladde- og bilagslager er ikke tilgængeligt i denne driftsmiljø.");
    this.name = "PersistenceUnavailableError";
  }
}

export function isPersistenceUnavailable(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "PERSISTENCE_UNAVAILABLE"
  );
}

function safePersistenceErrorField(error: unknown, field: "name" | "code") {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, unknown>;
  if (!(field in candidate)) return undefined;
  const value = candidate[field];
  return typeof value === "string" && /^[A-Z0-9_.:-]{1,80}$/iu.test(value)
    ? value
    : undefined;
}

function logVercelPersistenceInitializationFailure(
  error: unknown,
  environment: Record<string, string | undefined>,
) {
  // Log kun fejlklassifikation og tilstedeværelsen af konfiguration. URL'er,
  // tokens og fejlbeskeder kan indeholde secrets og må aldrig ende i loggen.
  console.error("Vercel persistence initialization failed", {
    errorName: safePersistenceErrorField(error, "name"),
    errorCode: safePersistenceErrorField(error, "code"),
    hasDatabaseUrl: Boolean(environment.TURSO_DATABASE_URL?.trim()),
    hasDatabaseToken: Boolean(environment.TURSO_AUTH_TOKEN?.trim()),
    hasBlobStoreId: Boolean(environment.BLOB_STORE_ID?.trim()),
    hasBlobToken: Boolean(environment.BLOB_READ_WRITE_TOKEN?.trim()),
    hasOidcToken: Boolean(environment.VERCEL_OIDC_TOKEN?.trim()),
  });
}

export async function getPersistenceBindings(): Promise<PersistenceBindings> {
  const runtimeEnvironment = typeof process === "undefined" ? {} : process.env;
  const { hasVercelPersistenceSignal } = await import("./persistence-runtime");

  if (hasVercelPersistenceSignal(runtimeEnvironment)) {
    if (!vercelBindingsPromise) {
      vercelBindingsPromise = import("./vercel-persistence")
        .then(async ({ createVercelPersistenceBindings, readVercelPersistenceEnvironment }) => {
          const environment = readVercelPersistenceEnvironment(runtimeEnvironment);
          if (!environment) throw new PersistenceUnavailableError();
          return createVercelPersistenceBindings(environment);
        })
        .catch((error) => {
          vercelBindingsPromise = null;
          throw error;
        });
    }

    try {
      return await vercelBindingsPromise;
    } catch (error) {
      if (isPersistenceUnavailable(error)) throw error;
      logVercelPersistenceInitializationFailure(error, runtimeEnvironment);
      throw new PersistenceUnavailableError();
    }
  }

  try {
    const { env } = await import("cloudflare:workers");
    const bindings = env as unknown as PersistenceBindings;
    if (!bindings.DB || !bindings.FILES) {
      throw new PersistenceUnavailableError();
    }
    return bindings;
  } catch (error) {
    if (isPersistenceUnavailable(error)) throw error;
    throw new PersistenceUnavailableError();
  }
}

async function runSchemaBatch(DB: D1Database, statements: readonly string[]) {
  const batch = statements.map((statement) => DB.prepare(statement));
  await DB.batch(batch);
}

async function ensureLegacySchema() {
  if (!legacySchemaPromise) {
    legacySchemaPromise = (async () => {
      const { DB } = await getPersistenceBindings();
      await runSchemaBatch(DB, legacySchemaStatements);
    })().catch((error) => {
      legacySchemaPromise = null;
      throw error;
    });
  }
  await legacySchemaPromise;
}

export async function ensurePortalSchema() {
  if (!portalSchemaPromise) {
    portalSchemaPromise = (async () => {
      const { DB } = await getPersistenceBindings();
      const [{ assertDatabaseEnvironment }, { readRuntimeEnvironment, deploymentStage }] = await Promise.all([
        import("./environment-guard"),
        import("../features/runtime/environment"),
      ]);
      const environment = await readRuntimeEnvironment();
      if (deploymentStage(environment) !== "production") {
        await runSchemaBatch(DB, portalSchemaStatements);
      } else {
        const { assertMigrationState } = await import("./migration-guard");
        await assertMigrationState(DB);
      }
      // Production schema is deployed explicitly by the migration job.
      await assertDatabaseEnvironment(DB, environment);
    })().catch((error) => {
      portalSchemaPromise = null;
      throw error;
    });
  }
  await portalSchemaPromise;
}

/** Backwards-compatible bootstrap used by the existing draft/upload routes. */
export async function ensurePersistenceSchema() {
  await ensureLegacySchema();
  await ensurePortalSchema();
}

export function readDraftCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)dgita_draft=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function draftCookie(id: string) {
  return `dgita_draft=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`;
}

export async function getDraft(id: string) {
  const { DB } = await getPersistenceBindings();
  return DB.prepare(
    "SELECT id, state_json, status, updated_at FROM application_drafts WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<DraftRow>();
}

export async function getDraftAttachments(id: string) {
  const { DB } = await getPersistenceBindings();
  const result = await DB.prepare(
    `SELECT id, draft_id, kind, name, size, content_type, storage_key
     FROM application_attachments WHERE draft_id = ? ORDER BY created_at`,
  )
    .bind(id)
    .all<AttachmentRow>();
  return result.results;
}

export function hydrateAttachments(
  state: ApplicationFormState,
  rows: AttachmentRow[],
): ApplicationFormState {
  const attachments: ApplicationFormState["attachments"] = {
    "risk-assessment": [],
    "data-processing-agreement": [],
    contract: [],
    "supplier-checklist": [],
    architecture: [],
  };
  for (const row of rows) {
    if (!(row.kind in attachments)) continue;
    const attachment: AttachmentDraft = {
      id: row.id,
      kind: row.kind,
      name: row.name,
      size: row.size,
      type: row.content_type,
      status: "uploaded",
    };
    attachments[row.kind].push(attachment);
  }
  return { ...state, attachments };
}

export function safeUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
}

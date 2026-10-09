import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`);

const updatedAt = () =>
  text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`);

export const portalEnvironment = sqliteTable("portal_environment", {
  id: integer("id").primaryKey(),
  purpose: text("purpose", { enum: ["test", "production"] }).notNull(),
}, (table) => [
  check("portal_environment_singleton", sql`${table.id} = 1`),
  check("portal_environment_purpose", sql`${table.purpose} IN ('test', 'production')`),
]);

export const portalOidcUsedStates = sqliteTable("portal_oidc_used_states", {
  stateHash: text("state_hash").primaryKey(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [index("portal_oidc_used_states_expires_idx").on(table.expiresAt)]);

/**
 * Compatibility tables used by the original draft/upload API. New protected
 * workflows use the tenant-aware portal_* tables below.
 */
export const applicationDrafts = sqliteTable(
  "application_drafts",
  {
    id: text("id").primaryKey(),
    schemaVersion: text("schema_version").notNull(),
    stateJson: text("state_json").notNull(),
    status: text("status", { enum: ["draft", "submitted"] })
      .notNull()
      .default("draft"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    submittedAt: text("submitted_at"),
  },
  (table) => [index("application_drafts_status_idx").on(table.status)],
);

export const applicationAttachments = sqliteTable(
  "application_attachments",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => applicationDrafts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("application_attachments_draft_idx").on(table.draftId)],
);

export const portalTenants = sqliteTable(
  "portal_tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    authorityCode: text("authority_code"),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("portal_tenants_slug_uidx").on(table.slug),
    index("portal_tenants_status_idx").on(table.status),
  ],
);

export const portalBootstrapState = sqliteTable(
  "portal_bootstrap_state",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    version: text("version").notNull(),
    completedAt: text("completed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.scope] })],
);

export const portalUsers = sqliteTable(
  "portal_users",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    identityProvider: text("identity_provider").notNull(),
    externalSubject: text("external_subject").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["invited", "active", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastLoginAt: text("last_login_at"),
  },
  (table) => [
    uniqueIndex("portal_users_tenant_provider_subject_uidx").on(
      table.tenantId,
      table.identityProvider,
      table.externalSubject,
    ),
    index("portal_users_tenant_email_idx").on(table.tenantId, table.email),
    index("portal_users_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const portalUserRoles = sqliteTable(
  "portal_user_roles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "dgita_consultant", "admin"] }).notNull(),
    createdAt: createdAt(),
    createdByUserId: text("created_by_user_id"),
  },
  (table) => [
    uniqueIndex("portal_user_roles_tenant_user_role_uidx").on(
      table.tenantId,
      table.userId,
      table.role,
    ),
    index("portal_user_roles_tenant_role_idx").on(table.tenantId, table.role),
  ],
);

export const portalSessions = sqliteTable(
  "portal_sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    provider: text("provider", { enum: ["dev", "entra", "fk"] }).notNull(),
    providerSessionId: text("provider_session_id"),
    rolesSnapshotJson: text("roles_snapshot_json").notNull().default("[]"),
    createdAt: createdAt(),
    expiresAt: text("expires_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    revokedAt: text("revoked_at"),
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
  },
  (table) => [
    uniqueIndex("portal_sessions_token_hash_uidx").on(table.tokenHash),
    index("portal_sessions_user_active_idx").on(
      table.tenantId,
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
    index("portal_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const portalAuthRateLimits = sqliteTable(
  "portal_auth_rate_limits",
  {
    scope: text("scope").notNull(),
    subjectHash: text("subject_hash").notNull(),
    windowStartedAt: integer("window_started_at").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.subjectHash] }),
    index("portal_auth_rate_limits_updated_idx").on(table.updatedAt),
  ],
);

export const portalApplications = sqliteTable(
  "portal_applications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "restrict" }),
    caseNumber: text("case_number").notNull(),
    title: text("title").notNull().default("Ny ansøgning"),
    systemName: text("system_name"),
    status: text("status", {
      enum: [
        "draft",
        "submitted",
        "awaiting_leader",
        "under_review",
        "changes_requested",
        "approved",
        "rejected",
        "closed",
      ],
    })
      .notNull()
      .default("draft"),
    phase: text("phase").notNull().default("draft"),
    assignedConsultantUserId: text("assigned_consultant_user_id").references(
      () => portalUsers.id,
      { onDelete: "set null" },
    ),
    draftSchemaVersion: text("draft_schema_version").notNull(),
    draftStateJson: text("draft_state_json").notNull(),
    rowVersion: integer("row_version").notNull().default(1),
    currentVersionNumber: integer("current_version_number").notNull().default(0),
    currentVersionId: text("current_version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    submittedAt: text("submitted_at"),
    closedAt: text("closed_at"),
  },
  (table) => [
    uniqueIndex("portal_applications_tenant_case_uidx").on(
      table.tenantId,
      table.caseNumber,
    ),
    index("portal_applications_owner_status_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
      table.updatedAt,
    ),
    index("portal_applications_queue_idx").on(
      table.tenantId,
      table.status,
      table.phase,
      table.updatedAt,
    ),
    index("portal_applications_assignee_idx").on(
      table.tenantId,
      table.assignedConsultantUserId,
      table.status,
    ),
  ],
);

export const portalApplicationVersions = sqliteTable(
  "portal_application_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => portalApplications.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    schemaVersion: text("schema_version").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    snapshotSha256: text("snapshot_sha256").notNull(),
    attachmentManifestSha256: text("attachment_manifest_sha256"),
    submittedByUserId: text("submitted_by_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    submittedAt: text("submitted_at").notNull(),
  },
  (table) => [
    uniqueIndex("portal_application_versions_application_number_uidx").on(
      table.applicationId,
      table.versionNumber,
    ),
    index("portal_application_versions_tenant_application_idx").on(
      table.tenantId,
      table.applicationId,
      table.submittedAt,
    ),
  ],
);

export const portalAttachments = sqliteTable(
  "portal_attachments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => portalApplications.id, { onDelete: "restrict" }),
    applicationVersionId: text("application_version_id").references(
      () => portalApplicationVersions.id,
      { onDelete: "restrict" },
    ),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    originalName: text("original_name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentType: text("content_type").notNull(),
    storageKey: text("storage_key").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    status: text("status", {
      enum: ["pending", "verifying", "ready", "quarantined", "deleted"],
    })
      .notNull()
      .default("pending"),
    scanStatus: text("scan_status", {
      enum: ["pending", "clean", "infected", "failed", "not_configured"],
    })
      .notNull()
      .default("pending"),
    uploadedByUserId: text("uploaded_by_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    immutableAt: text("immutable_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("portal_attachments_storage_key_uidx").on(table.storageKey),
    index("portal_attachments_owner_idx").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
    ),
    index("portal_attachments_application_idx").on(
      table.tenantId,
      table.applicationId,
      table.createdAt,
    ),
    index("portal_attachments_version_idx").on(table.applicationVersionId),
  ],
);

export const portalAttachmentUploadLocks = sqliteTable(
  "portal_attachment_upload_locks",
  {
    attachmentId: text("attachment_id")
      .primaryKey()
      .references(() => portalAttachments.id, { onDelete: "cascade" }),
    authoritativeStorageKey: text("authoritative_storage_key").notNull(),
    leaseToken: text("lease_token").notNull(),
    acquiredAt: text("acquired_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("portal_attachment_upload_locks_storage_key_uidx").on(
      table.authoritativeStorageKey,
    ),
    uniqueIndex("portal_attachment_upload_locks_token_uidx").on(table.leaseToken),
    index("portal_attachment_upload_locks_expiry_idx").on(table.expiresAt),
  ],
);

export const portalContentEntries = sqliteTable(
  "portal_content_entries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    locale: text("locale").notNull().default("da-DK"),
    pagePath: text("page_path").notNull(),
    contentType: text("content_type").notNull(),
    valueJson: text("value_json").notNull(),
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"),
    version: integer("version").notNull().default(1),
    updatedByUserId: text("updated_by_user_id").references(() => portalUsers.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    publishedAt: text("published_at"),
  },
  (table) => [
    uniqueIndex("portal_content_entries_tenant_key_locale_uidx").on(
      table.tenantId,
      table.key,
      table.locale,
    ),
    index("portal_content_entries_page_status_idx").on(
      table.tenantId,
      table.pagePath,
      table.status,
    ),
  ],
);

export const portalImages = sqliteTable(
  "portal_images",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    contentEntryId: text("content_entry_id").references(() => portalContentEntries.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    altText: text("alt_text").notNull().default(""),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    status: text("status", { enum: ["ready", "quarantined", "deleted"] })
      .notNull()
      .default("ready"),
    uploadedByUserId: text("uploaded_by_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("portal_images_storage_key_uidx").on(table.storageKey),
    index("portal_images_tenant_status_idx").on(table.tenantId, table.status),
    index("portal_images_content_entry_idx").on(table.contentEntryId),
  ],
);

export const portalDgitaApprovals = sqliteTable(
  "portal_dgita_approvals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => portalApplications.id, { onDelete: "restrict" }),
    applicationVersionId: text("application_version_id").references(
      () => portalApplicationVersions.id,
      { onDelete: "restrict" },
    ),
    reviewerUserId: text("reviewer_user_id").references(() => portalUsers.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["pending", "in_review", "changes_requested", "approved", "rejected"],
    })
      .notNull()
      .default("pending"),
    internalFieldsJson: text("internal_fields_json").notNull().default("{}"),
    decisionComment: text("decision_comment"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    decidedAt: text("decided_at"),
  },
  (table) => [
    uniqueIndex("portal_dgita_approvals_tenant_application_uidx").on(
      table.tenantId,
      table.applicationId,
    ),
    index("portal_dgita_approvals_queue_idx").on(
      table.tenantId,
      table.status,
      table.updatedAt,
    ),
    index("portal_dgita_approvals_application_idx").on(
      table.tenantId,
      table.applicationId,
      table.applicationVersionId,
    ),
  ],
);

export const portalDgitaReviewHistory = sqliteTable(
  "portal_dgita_review_history",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => portalTenants.id, { onDelete: "restrict" }),
    applicationId: text("application_id").notNull().references(() => portalApplications.id, { onDelete: "restrict" }),
    applicationVersionId: text("application_version_id").references(() => portalApplicationVersions.id, { onDelete: "restrict" }),
    applicationRevision: integer("application_revision").notNull(),
    reviewerUserId: text("reviewer_user_id").notNull().references(() => portalUsers.id, { onDelete: "restrict" }),
    reviewerSubject: text("reviewer_subject").notNull(),
    internalFieldsJson: text("internal_fields_json").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("portal_dgita_review_history_revision_uidx").on(table.tenantId, table.applicationId, table.applicationRevision),
    index("portal_dgita_review_history_version_idx").on(table.tenantId, table.applicationId, table.applicationVersionId, table.applicationRevision),
  ],
);

export const portalFieldComments = sqliteTable(
  "portal_field_comments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => portalApplications.id, { onDelete: "restrict" }),
    applicationVersionId: text("application_version_id").references(
      () => portalApplicationVersions.id,
      { onDelete: "restrict" },
    ),
    fieldId: text("field_id").notNull(),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "restrict" }),
    visibility: text("visibility", { enum: ["applicant", "internal"] })
      .notNull()
      .default("applicant"),
    body: text("body").notNull(),
    status: text("status", { enum: ["active", "resolved", "deleted"] })
      .notNull()
      .default("active"),
    parentCommentId: text("parent_comment_id"),
    createdAt: createdAt(),
    editedAt: text("edited_at"),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("portal_field_comments_field_idx").on(
      table.tenantId,
      table.applicationId,
      table.fieldId,
      table.createdAt,
    ),
    index("portal_field_comments_visibility_idx").on(
      table.tenantId,
      table.applicationId,
      table.visibility,
    ),
  ],
);

export const portalCaseComments = sqliteTable(
  "portal_case_comments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => portalApplications.id, { onDelete: "restrict" }),
    applicationVersionId: text("application_version_id").references(
      () => portalApplicationVersions.id,
      { onDelete: "restrict" },
    ),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "restrict" }),
    visibility: text("visibility", { enum: ["shared", "internal"] })
      .notNull()
      .default("shared"),
    category: text("category").notNull().default("comment"),
    body: text("body").notNull(),
    status: text("status", { enum: ["active", "resolved", "deleted"] })
      .notNull()
      .default("active"),
    parentCommentId: text("parent_comment_id"),
    createdAt: createdAt(),
    editedAt: text("edited_at"),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("portal_case_comments_case_idx").on(
      table.tenantId,
      table.applicationId,
      table.createdAt,
    ),
    index("portal_case_comments_visibility_idx").on(
      table.tenantId,
      table.applicationId,
      table.visibility,
    ),
  ],
);

export const portalAuditEvents = sqliteTable(
  "portal_audit_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    applicationId: text("application_id").references(() => portalApplications.id, {
      onDelete: "restrict",
    }),
    actorUserId: text("actor_user_id").references(() => portalUsers.id, {
      onDelete: "restrict",
    }),
    actorSubject: text("actor_subject").notNull(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    ipHash: text("ip_hash"),
    occurredAt: text("occurred_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("portal_audit_events_application_idx").on(
      table.tenantId,
      table.applicationId,
      table.occurredAt,
    ),
    index("portal_audit_events_entity_idx").on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index("portal_audit_events_actor_idx").on(
      table.tenantId,
      table.actorUserId,
      table.occurredAt,
    ),
  ],
);

export const portalNotifications = sqliteTable(
  "portal_notifications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "cascade" }),
    applicationId: text("application_id").references(() => portalApplications.id, {
      onDelete: "restrict",
    }),
    sourceEventId: text("source_event_id").references(() => portalAuditEvents.id, {
      onDelete: "restrict",
    }),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    linkPath: text("link_path"),
    status: text("status", { enum: ["unread", "read", "dismissed"] })
      .notNull()
      .default("unread"),
    createdAt: createdAt(),
    readAt: text("read_at"),
  },
  (table) => [
    uniqueIndex("portal_notifications_recipient_event_uidx").on(
      table.recipientUserId,
      table.sourceEventId,
    ),
    index("portal_notifications_recipient_status_idx").on(
      table.tenantId,
      table.recipientUserId,
      table.status,
      table.createdAt,
    ),
    index("portal_notifications_application_idx").on(
      table.tenantId,
      table.applicationId,
      table.createdAt,
    ),
  ],
);

export const portalReceipts = sqliteTable(
  "portal_receipts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => portalApplications.id, { onDelete: "restrict" }),
    applicationVersionId: text("application_version_id")
      .notNull()
      .references(() => portalApplicationVersions.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["submission", "approval", "final"] }).notNull(),
    status: text("status", { enum: ["generating", "ready", "failed"] })
      .notNull()
      .default("generating"),
    storageKey: text("storage_key").notNull(),
    checksumSha256: text("checksum_sha256"),
    sizeBytes: integer("size_bytes"),
    contentType: text("content_type").notNull().default("application/pdf"),
    createdByUserId: text("created_by_user_id").references(() => portalUsers.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
    generatedAt: text("generated_at"),
    failureReason: text("failure_reason"),
  },
  (table) => [
    uniqueIndex("portal_receipts_version_kind_uidx").on(
      table.tenantId,
      table.applicationVersionId,
      table.kind,
    ),
    uniqueIndex("portal_receipts_storage_key_uidx").on(table.storageKey),
    index("portal_receipts_application_idx").on(
      table.tenantId,
      table.applicationId,
      table.createdAt,
    ),
  ],
);

export const portalMailOutbox = sqliteTable(
  "portal_mail_outbox",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    applicationId: text("application_id").references(() => portalApplications.id, {
      onDelete: "restrict",
    }),
    recipientUserId: text("recipient_user_id").references(() => portalUsers.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    templateKey: text("template_key").notNull(),
    subject: text("subject").notNull(),
    textBody: text("text_body").notNull(),
    htmlBody: text("html_body").notNull(),
    attachmentsJson: text("attachments_json").notNull().default("[]"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", {
      enum: ["queued", "processing", "sent", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
    provider: text("provider").notNull().default("microsoft_graph"),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    createdByUserId: text("created_by_user_id").references(() => portalUsers.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sentAt: text("sent_at"),
  },
  (table) => [
    uniqueIndex("portal_mail_outbox_tenant_idempotency_uidx").on(
      table.tenantId,
      table.idempotencyKey,
    ),
    index("portal_mail_outbox_queue_idx").on(
      table.tenantId,
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    index("portal_mail_outbox_application_idx").on(
      table.tenantId,
      table.applicationId,
      table.createdAt,
    ),
  ],
);

export const portalApprovalRequests = sqliteTable(
  "portal_approval_requests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => portalTenants.id, { onDelete: "restrict" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => portalApplications.id, { onDelete: "restrict" }),
    applicationVersionId: text("application_version_id")
      .notNull()
      .references(() => portalApplicationVersions.id, { onDelete: "restrict" }),
    approverEmail: text("approver_email").notNull(),
    approverName: text("approver_name").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status", {
      enum: [
        "pending",
        "approving",
        "rejecting",
        "approved",
        "rejected",
        "expired",
        "cancelled",
      ],
    })
      .notNull()
      .default("pending"),
    decisionComment: text("decision_comment"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    expiresAt: text("expires_at").notNull(),
    decidedAt: text("decided_at"),
  },
  (table) => [
    uniqueIndex("portal_approval_requests_token_hash_uidx").on(table.tokenHash),
    index("portal_approval_requests_application_idx").on(
      table.tenantId,
      table.applicationId,
      table.status,
      table.createdAt,
    ),
    index("portal_approval_requests_expiry_idx").on(table.status, table.expiresAt),
  ],
);

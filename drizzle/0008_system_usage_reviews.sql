CREATE TABLE `portal_system_usage_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`usage_id` text NOT NULL,
	`row_version` integer NOT NULL,
	`recorded_by_user_id` text NOT NULL,
	`name` text NOT NULL,
	`review_json` text NOT NULL,
	`event_type` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `portal_tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usage_id`) REFERENCES `portal_system_usages`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `portal_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "portal_system_usage_revisions_event" CHECK("portal_system_usage_revisions"."event_type" IN ('saved', 'confirmed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_system_usage_revisions_usage_uidx` ON `portal_system_usage_revisions` (`tenant_id`,`usage_id`,`row_version`);--> statement-breakpoint
CREATE TABLE `portal_system_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`recorded_by_user_id` text NOT NULL,
	`name` text NOT NULL,
	`source` text DEFAULT 'synthetic' NOT NULL,
	`kitos_org_uuid` text,
	`kitos_usage_uuid` text,
	`row_version` integer DEFAULT 1 NOT NULL,
	`review_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `portal_tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `portal_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "portal_system_usages_synthetic" CHECK("portal_system_usages"."source" = 'synthetic' AND "portal_system_usages"."kitos_org_uuid" IS NULL AND "portal_system_usages"."kitos_usage_uuid" IS NULL),
	CONSTRAINT "portal_system_usages_revision" CHECK("portal_system_usages"."row_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `portal_system_usages_registrant_idx` ON `portal_system_usages` (`tenant_id`,`recorded_by_user_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `portal_system_usages_kitos_uidx` ON `portal_system_usages` (`tenant_id`,`kitos_org_uuid`,`kitos_usage_uuid`);
--> statement-breakpoint
CREATE TRIGGER portal_system_usages_insert_guard
BEFORE INSERT ON portal_system_usages
WHEN NOT EXISTS (SELECT 1 FROM portal_users WHERE id = NEW.recorded_by_user_id AND tenant_id = NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'system usage registrant must belong to tenant'); END;
--> statement-breakpoint
CREATE TRIGGER portal_system_usages_identity_guard
BEFORE UPDATE ON portal_system_usages
WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id
  OR NEW.recorded_by_user_id IS NOT OLD.recorded_by_user_id
  OR NEW.source IS NOT OLD.source OR NEW.created_at IS NOT OLD.created_at
  OR NEW.row_version != OLD.row_version + 1
BEGIN SELECT RAISE(ABORT, 'system usage identity is stable and revision must advance once'); END;
--> statement-breakpoint
CREATE TRIGGER portal_system_usage_revisions_no_update
BEFORE UPDATE ON portal_system_usage_revisions
BEGIN SELECT RAISE(ABORT, 'system usage history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER portal_system_usage_revisions_no_delete
BEFORE DELETE ON portal_system_usage_revisions
BEGIN SELECT RAISE(ABORT, 'system usage history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER portal_system_usage_revisions_insert_guard
BEFORE INSERT ON portal_system_usage_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM portal_system_usages usage
  WHERE usage.id = NEW.usage_id AND usage.tenant_id = NEW.tenant_id
    AND usage.recorded_by_user_id = NEW.recorded_by_user_id
    AND usage.row_version = NEW.row_version AND usage.review_json = NEW.review_json
    AND usage.name = NEW.name AND usage.updated_at = NEW.created_at
)
BEGIN SELECT RAISE(ABORT, 'system usage history must match current record'); END;

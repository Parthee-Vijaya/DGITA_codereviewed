CREATE TABLE `portal_dgita_review_history` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`application_id` text NOT NULL,
	`application_version_id` text,
	`application_revision` integer NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`reviewer_subject` text NOT NULL,
	`internal_fields_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `portal_tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_id`) REFERENCES `portal_applications`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`application_version_id`) REFERENCES `portal_application_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `portal_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_dgita_review_history_revision_uidx` ON `portal_dgita_review_history` (`tenant_id`,`application_id`,`application_revision`);--> statement-breakpoint
CREATE INDEX `portal_dgita_review_history_version_idx` ON `portal_dgita_review_history` (`tenant_id`,`application_id`,`application_version_id`,`application_revision`);
--> statement-breakpoint
CREATE TRIGGER portal_dgita_review_history_no_update
    BEFORE UPDATE ON portal_dgita_review_history
    BEGIN SELECT RAISE(ABORT, 'review history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER portal_dgita_review_history_no_delete
    BEFORE DELETE ON portal_dgita_review_history
    BEGIN SELECT RAISE(ABORT, 'review history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER portal_dgita_review_history_insert_guard
    BEFORE INSERT ON portal_dgita_review_history
    WHEN NOT EXISTS (
      SELECT 1 FROM portal_applications application
      INNER JOIN portal_users reviewer ON reviewer.id = NEW.reviewer_user_id
        AND reviewer.tenant_id = NEW.tenant_id AND reviewer.external_subject = NEW.reviewer_subject
      WHERE application.id = NEW.application_id AND application.tenant_id = NEW.tenant_id
        AND application.row_version = NEW.application_revision
        AND application.current_version_id IS NEW.application_version_id
        AND (NEW.application_version_id IS NULL OR EXISTS (
          SELECT 1 FROM portal_application_versions version
          WHERE version.id = NEW.application_version_id AND version.tenant_id = NEW.tenant_id
            AND version.application_id = NEW.application_id
        ))
    )
    BEGIN SELECT RAISE(ABORT, 'review history must match the current case revision and tenant'); END;

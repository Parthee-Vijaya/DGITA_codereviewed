CREATE TABLE `portal_environment` (
	`id` integer PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	CONSTRAINT "portal_environment_singleton" CHECK("portal_environment"."id" = 1),
	CONSTRAINT "portal_environment_purpose" CHECK("portal_environment"."purpose" IN ('test', 'production'))
);
--> statement-breakpoint
CREATE TABLE `portal_oidc_used_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portal_oidc_used_states_expires_idx` ON `portal_oidc_used_states` (`expires_at`);
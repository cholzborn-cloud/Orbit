CREATE TABLE `approval_requests` (
	`tool_call_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tool` text NOT NULL,
	`automation_run_id` text,
	`requested_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `tool_call_id`),
	FOREIGN KEY (`automation_run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `approval_requests_automation_run_idx` ON `approval_requests` (`automation_run_id`);--> statement-breakpoint
CREATE TABLE `approval_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bot_id` text,
	`tool` text NOT NULL,
	`mode` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `approval_rules_user_id_idx` ON `approval_rules` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `approval_rules_global_unique_idx` ON `approval_rules` (`user_id`,`tool`) WHERE "approval_rules"."bot_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `approval_rules_bot_unique_idx` ON `approval_rules` (`user_id`,`tool`,`bot_id`) WHERE "approval_rules"."bot_id" is not null;--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text,
	`status` text NOT NULL,
	`trigger` text DEFAULT 'schedule' NOT NULL,
	`error` text,
	`started_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_runs_automation_idx` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Berlin' NOT NULL,
	`target` text DEFAULT 'new' NOT NULL,
	`chat_id` text,
	`notify` text DEFAULT 'app' NOT NULL,
	`model` text,
	`effort` text,
	`context` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`paused_reason` text,
	`last_run_at` integer,
	`resumed_at` integer,
	`next_run_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automations_user_id_idx` ON `automations` (`user_id`);--> statement-breakpoint
CREATE INDEX `automations_next_run_idx` ON `automations` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `bot_connectors` (
	`bot_id` text NOT NULL,
	`connector_id` text NOT NULL,
	PRIMARY KEY(`bot_id`, `connector_id`),
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `mcp_connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`third_party_id` text NOT NULL,
	`name` text NOT NULL,
	`avatar` text NOT NULL,
	`color` text,
	`job` text NOT NULL,
	`instructions` text,
	`is_main` integer DEFAULT false NOT NULL,
	`sandbox_id` text,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bots_user_id_idx` ON `bots` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bots_one_main_per_user_idx` ON `bots` (`user_id`) WHERE "bots"."is_main";--> statement-breakpoint
CREATE TABLE `chat_members` (
	`chat_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	PRIMARY KEY(`chat_id`, `bot_id`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_members_bot_id_idx` ON `chat_members` (`bot_id`);--> statement-breakpoint
CREATE TABLE `chat_messages_index` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_index_user_chat_idx` ON `chat_messages_index` (`user_id`,`chat_id`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'direct' NOT NULL,
	`name` text,
	`last_message_preview` text,
	`last_message_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chats_user_id_idx` ON `chats` (`user_id`);--> statement-breakpoint
CREATE TABLE `jev_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text,
	`kind` text NOT NULL,
	`model` text,
	`reason` text,
	`duration_ms` integer,
	`payload` text,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jev_log_user_id_created_at_idx` ON `jev_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mcp_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`auth_encrypted` text,
	`auth_header` text,
	`oauth_encrypted` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orbi_work` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_user_id_name_idx` ON `skills` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `skills_user_id_idx` ON `skills` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`jev_auto` integer DEFAULT true NOT NULL,
	`jev_handoff` integer DEFAULT false NOT NULL,
	`base_instructions` text,
	`updated_at` integer DEFAULT (unixepoch('subsecond') * 1000)
);

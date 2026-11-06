CREATE TABLE `chat_messages` (
	`chat_id` text NOT NULL,
	`id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`metadata` text,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	PRIMARY KEY(`chat_id`, `id`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_position_idx` ON `chat_messages` (`chat_id`,`position`);
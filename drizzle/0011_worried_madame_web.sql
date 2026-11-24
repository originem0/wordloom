CREATE TABLE `encounters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expression_id` integer,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`text_before` text,
	`my_attempt` text,
	`source_type` text,
	`source_title` text,
	`source_locator` text,
	`outcome` text,
	`cue` text,
	`feedback` text,
	`occurred_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`expression_id`) REFERENCES `expressions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `encounters_expression_idx` ON `encounters` (`expression_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `encounters_created_at_idx` ON `encounters` (`created_at`);--> statement-breakpoint
CREATE TABLE `expressions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text NOT NULL,
	`norm` text NOT NULL,
	`focus` text,
	`intent` text,
	`intent_by` text,
	`ai_intent` text,
	`gloss` text,
	`note` text,
	`status` text DEFAULT 'seen' NOT NULL,
	`active_since` integer,
	`next_scene` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `expressions_norm_idx` ON `expressions` (`norm`);--> statement-breakpoint
CREATE INDEX `expressions_status_created_idx` ON `expressions` (`status`,`created_at`);
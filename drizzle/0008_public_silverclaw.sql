CREATE TABLE `practices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_path` text NOT NULL,
	`topic` text DEFAULT '',
	`visual_prompt` text NOT NULL,
	`scene_frame` text,
	`target_words` text,
	`task_brief` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `practices_created_at_idx` ON `practices` (`created_at`);
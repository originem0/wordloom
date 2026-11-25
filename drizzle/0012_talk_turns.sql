CREATE TABLE `talk_turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread` integer NOT NULL,
	`said` text NOT NULL,
	`reply` text NOT NULL,
	`notes` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `talk_turns_thread_idx` ON `talk_turns` (`thread`,`id`);
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`ipa` text,
	`pos` text,
	`cefr` text,
	`cefr_confidence` text,
	`core_meaning` text,
	`wad` real,
	`wap` real,
	`etymology` text,
	`collocations` text,
	`examples` text,
	`context_ladder` text,
	`phrases` text,
	`synonyms` text,
	`antonyms` text,
	`min_pair` text,
	`family_comparison` text,
	`schema_analysis` text,
	`boundary_tests` text,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`story_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_word_unique` ON `cards` (`word`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_path` text NOT NULL,
	`prompt` text DEFAULT '',
	`story` text NOT NULL,
	`sources` text,
	`created_at` integer NOT NULL
);

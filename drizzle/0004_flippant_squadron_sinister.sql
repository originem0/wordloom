CREATE TABLE `chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`form` text NOT NULL,
	`category` text NOT NULL,
	`core_meaning` text NOT NULL,
	`register` text NOT NULL,
	`frequency` text NOT NULL,
	`slots` text,
	`examples` text NOT NULL,
	`pitfall` text,
	`contrast` text,
	`theoretical_anchors` text,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chunks_created_at_idx` ON `chunks` (`created_at`);--> statement-breakpoint
CREATE INDEX `chunks_category_idx` ON `chunks` (`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `chunks_form_category_unique` ON `chunks` (`form`,`category`);
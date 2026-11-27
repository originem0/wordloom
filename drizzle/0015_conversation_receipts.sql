CREATE TABLE `talk_receipts` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `talk_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `work_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_work_key_unique` ON `jobs` (`work_key`);--> statement-breakpoint
INSERT INTO talk_threads(id) SELECT DISTINCT thread FROM talk_turns;--> statement-breakpoint
-- Keep the counts / IDs consumed by task clients, and discard historical copies of card bodies.
UPDATE jobs SET result = json_object('success', (SELECT json_group_array(json_extract(value, '$.id')) FROM json_each(jobs.result, '$.success')), 'existing', (SELECT json_group_array(json_extract(value, '$.id')) FROM json_each(jobs.result, '$.existing')), 'failed', json(coalesce(json_extract(result, '$.failed'), '[]'))) WHERE type = 'cards' AND json_valid(result) AND json_type(result, '$.success[0]') = 'object';

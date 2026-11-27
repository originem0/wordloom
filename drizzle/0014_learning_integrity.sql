CREATE TABLE `evaluation_window` (
	`id` integer PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learning_days` (
	`day` integer PRIMARY KEY NOT NULL,
	`testable` integer DEFAULT 0 NOT NULL,
	`attempted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `encounters` ADD `target_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `expressions` ADD `focus_start` integer;--> statement-breakpoint
ALTER TABLE `expressions` ADD `target_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `expressions` ADD `learning_history` text;--> statement-breakpoint
ALTER TABLE `talk_turns` ADD `message_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `talk_turns_message_id_unique` ON `talk_turns` (`message_id`);--> statement-breakpoint
-- Retain the anonymous activity date but remove a duplicate of the private utterance.
UPDATE encounters SET text = '', text_before = NULL, my_attempt = NULL, feedback = NULL WHERE kind = 'looked_up' AND expression_id IS NULL;--> statement-breakpoint
-- Older installations may contain two historical spellings of a word. Preserve
-- both IDs while enforcing case-independent identity for all new writes.
CREATE TRIGGER cards_word_insert_guard BEFORE INSERT ON cards
WHEN EXISTS (SELECT 1 FROM cards WHERE lower(word) = lower(NEW.word) AND word <> NEW.word)
BEGIN SELECT RAISE(ABORT, 'Card word already exists'); END;--> statement-breakpoint
CREATE TRIGGER cards_word_update_guard BEFORE UPDATE OF word ON cards
WHEN EXISTS (SELECT 1 FROM cards WHERE lower(word) = lower(NEW.word) AND id <> NEW.id)
BEGIN SELECT RAISE(ABORT, 'Card word already exists'); END;

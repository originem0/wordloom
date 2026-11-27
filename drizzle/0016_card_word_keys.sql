ALTER TABLE `cards` ADD `word_key` text;--> statement-breakpoint
CREATE INDEX `cards_word_key_idx` ON `cards` (`word_key`);
--> statement-breakpoint
-- SQLite lower() folds ASCII only. The server finishes the Unicode keys once,
-- before accepting requests. Historical case variants keep their own IDs.
UPDATE cards SET word_key = lower(word) WHERE word NOT GLOB '*[^ -~]*';
--> statement-breakpoint
DROP TRIGGER cards_word_insert_guard;
--> statement-breakpoint
DROP TRIGGER cards_word_update_guard;
--> statement-breakpoint
CREATE TRIGGER cards_word_insert_guard BEFORE INSERT ON cards
WHEN (NEW.word_key IS NULL AND NEW.word GLOB '*[^ -~]*')
  OR EXISTS (SELECT 1 FROM cards WHERE word_key = coalesce(NEW.word_key, lower(NEW.word)))
BEGIN SELECT RAISE(ABORT, 'Invalid or duplicate card word key'); END;
--> statement-breakpoint
CREATE TRIGGER cards_word_update_guard BEFORE UPDATE OF word ON cards
WHEN (NEW.word_key IS NULL AND NEW.word GLOB '*[^ -~]*')
  OR EXISTS (SELECT 1 FROM cards WHERE word_key =
    (CASE WHEN NEW.word NOT GLOB '*[^ -~]*' THEN lower(NEW.word) ELSE NEW.word_key END) AND id <> NEW.id)
BEGIN SELECT RAISE(ABORT, 'Invalid or duplicate card word key'); END;
--> statement-breakpoint
CREATE TRIGGER cards_word_insert_key AFTER INSERT ON cards WHEN NEW.word_key IS NULL
BEGIN UPDATE cards SET word_key = lower(NEW.word) WHERE id = NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER cards_word_update_key AFTER UPDATE OF word ON cards WHEN NEW.word NOT GLOB '*[^ -~]*'
BEGIN UPDATE cards SET word_key = lower(NEW.word) WHERE id = NEW.id; END;

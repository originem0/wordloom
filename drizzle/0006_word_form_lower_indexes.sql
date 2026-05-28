-- Case-insensitive expression indexes for cards.word and chunks.form.
-- Drizzle's schema API does not express function-based indexes, so this
-- migration is hand-authored and the 0006 snapshot is a no-op relative to
-- 0005 (no schema change tracked by drizzle-kit).
--
-- Speeds up:
--   * splitExistingCards() lookups: lower(word) IN (...)
--   * Search relevance ranking: lower(word|form) = ? and LIKE 'x%'
CREATE INDEX IF NOT EXISTS `cards_word_lower_idx` ON `cards` (lower(`word`));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chunks_form_lower_idx` ON `chunks` (lower(`form`));

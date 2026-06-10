-- Add nullable JSON column for the new structured story artifact
-- (description + translation + sceneFrame + keyExpressions).
-- Legacy rows keep their plain-text `story` column and load with artifact=null.
ALTER TABLE `stories` ADD `artifact` text;

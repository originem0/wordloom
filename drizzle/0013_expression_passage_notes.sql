CREATE TABLE `expression_passage_notes` (
	`expression_id` integer NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`body` text NOT NULL,
	`examples` text,
	PRIMARY KEY(`expression_id`, `start_offset`, `end_offset`),
	FOREIGN KEY (`expression_id`) REFERENCES `expressions`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `later_highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`quote` text NOT NULL,
	`prefix` text NOT NULL,
	`suffix` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `later_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `later_highlights_item` ON `later_highlights` (`item_id`);
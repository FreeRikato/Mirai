CREATE TABLE `later_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `later_items` ADD `folder_id` text REFERENCES later_folders(id);--> statement-breakpoint
ALTER TABLE `later_items` ADD `folder_order` real DEFAULT 0 NOT NULL;
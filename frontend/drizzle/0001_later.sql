CREATE TABLE `later_items` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`embed` text NOT NULL,
	`title` text NOT NULL,
	`site` text NOT NULL,
	`author` text,
	`image` text,
	`length_sec` integer,
	`progress` real DEFAULT 0 NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'unread' NOT NULL,
	`worth` text NOT NULL,
	`tldr` text NOT NULL,
	`chapters` text NOT NULL,
	`content` text,
	`saved_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `later_items_url_unique` ON `later_items` (`url`);--> statement-breakpoint
CREATE INDEX `later_saved_at` ON `later_items` (`saved_at`);
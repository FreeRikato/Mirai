CREATE TABLE `priority_rankings` (
	`id` integer PRIMARY KEY NOT NULL,
	`ranked_at` integer NOT NULL,
	`cost_usd` real NOT NULL,
	`items` text NOT NULL
);

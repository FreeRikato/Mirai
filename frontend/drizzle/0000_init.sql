CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`machine` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_at` ON `events` (`at`);--> statement-breakpoint
CREATE TABLE `samples` (
	`machine` text NOT NULL,
	`at` integer NOT NULL,
	`cpu` real NOT NULL,
	`mem` real NOT NULL,
	`temp` real,
	PRIMARY KEY(`machine`, `at`)
);
--> statement-breakpoint
CREATE INDEX `samples_at` ON `samples` (`at`);
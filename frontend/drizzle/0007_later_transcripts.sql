CREATE TABLE `later_transcripts` (
	`video_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retry_at` integer,
	`model` text,
	`segments` text,
	`error` text,
	`queued_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

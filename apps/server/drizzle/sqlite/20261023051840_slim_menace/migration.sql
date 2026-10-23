ALTER TABLE `appeals` ADD `campusId` text NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `teacherUserId` text;--> statement-breakpoint
ALTER TABLE `records` ADD `tagIds` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_records` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`classId` text NOT NULL,
	`recorderId` text NOT NULL,
	`tagIds` text,
	`score` real DEFAULT 0 NOT NULL,
	`comment` text,
	`images` text,
	`week` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`recordedAt` integer NOT NULL,
	CONSTRAINT "records_status_check" CHECK(status IN ('active', 'revoked', 'appealing'))
);
--> statement-breakpoint
INSERT INTO `__new_records`(`id`, `campusId`, `classId`, `recorderId`, `score`, `comment`, `images`, `week`, `status`, `recordedAt`) SELECT `id`, `campusId`, `classId`, `recorderId`, `score`, `comment`, `images`, `week`, `status`, `recordedAt` FROM `records`;--> statement-breakpoint
DROP TABLE `records`;--> statement-breakpoint
ALTER TABLE `__new_records` RENAME TO `records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recordLogs` (
	`id` text PRIMARY KEY,
	`recordId` text NOT NULL,
	`action` text NOT NULL,
	`operatorId` text NOT NULL,
	`reason` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "record_logs_action_check" CHECK(action IN ('create', 'revoke', 'appeal', 'adjust', 'appeal_reject'))
);
--> statement-breakpoint
INSERT INTO `__new_recordLogs`(`id`, `recordId`, `action`, `operatorId`, `reason`, `createdAt`) SELECT `id`, `recordId`, `action`, `operatorId`, `reason`, `createdAt` FROM `recordLogs`;--> statement-breakpoint
DROP TABLE `recordLogs`;--> statement-breakpoint
ALTER TABLE `__new_recordLogs` RENAME TO `recordLogs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `records_campus_week_idx` ON `records` (`campusId`,`week`);--> statement-breakpoint
CREATE INDEX `records_class_idx` ON `records` (`classId`);--> statement-breakpoint
CREATE INDEX `records_status_idx` ON `records` (`status`);--> statement-breakpoint
CREATE INDEX `record_logs_record_idx` ON `recordLogs` (`recordId`);--> statement-breakpoint
CREATE INDEX `appeals_campus_idx` ON `appeals` (`campusId`);--> statement-breakpoint
CREATE INDEX `classes_teacher_idx` ON `classes` (`teacherUserId`);
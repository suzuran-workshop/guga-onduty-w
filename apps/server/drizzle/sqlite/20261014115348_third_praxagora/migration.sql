CREATE TABLE `oauth2_identity_links` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_sub` text NOT NULL,
	`raw_profile` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passwords` (
	`user_id` text PRIMARY KEY,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`token_hash` text PRIMARY KEY,
	`family_id` text NOT NULL,
	`sid` text NOT NULL,
	`sub` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`profile` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`username` text,
	`nickname` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webauthn_credentials` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`display_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `appeals` (
	`id` text PRIMARY KEY,
	`recordId` text NOT NULL,
	`teacherId` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewerId` text,
	`reviewComment` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`reviewedAt` integer,
	CONSTRAINT "appeals_status_check" CHECK(status IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE `awards` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`classId` text NOT NULL,
	`week` text NOT NULL,
	`category` text DEFAULT 'overall' NOT NULL,
	`note` text,
	`awardedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `campuses` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY,
	`gradeId` text NOT NULL,
	`campusId` text NOT NULL,
	`name` text NOT NULL,
	`classTeacher` text
);
--> statement-breakpoint
CREATE TABLE `dailySummaries` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`week` text NOT NULL,
	`date` text NOT NULL,
	`content` text NOT NULL,
	`notifiedTeachers` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dutyGroups` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`name` text NOT NULL,
	`members` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`name` text NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recordLogs` (
	`id` text PRIMARY KEY,
	`recordId` text NOT NULL,
	`action` text NOT NULL,
	`operatorId` text NOT NULL,
	`reason` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "record_logs_action_check" CHECK(action IN ('create', 'revoke', 'appeal', 'appeal_approve', 'appeal_reject'))
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`classId` text NOT NULL,
	`recorderId` text NOT NULL,
	`tagId` text,
	`score` real,
	`comment` text,
	`images` text,
	`week` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`recordedAt` integer NOT NULL,
	CONSTRAINT "records_status_check" CHECK(status IN ('active', 'revoked', 'appealing', 'appeal_approved'))
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`name` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`color` text DEFAULT '#FFAACC' NOT NULL,
	`category` text DEFAULT 'positive' NOT NULL,
	`isSystem` integer DEFAULT 0 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "tags_category_check" CHECK(category IN ('positive', 'negative', 'neutral'))
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`name` text NOT NULL,
	`tagIds` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `userProfiles` (
	`userId` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`displayName` text NOT NULL,
	`role` text NOT NULL,
	`groupId` text,
	CONSTRAINT "user_profiles_role_check" CHECK(role IN ('admin', 'teacher', 'student'))
);
--> statement-breakpoint
CREATE INDEX `oauth2_links_user_idx` ON `oauth2_identity_links` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth2_links_provider_sub_uidx` ON `oauth2_identity_links` (`provider`,`provider_sub`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_idx` ON `refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_sub_idx` ON `refresh_tokens` (`sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uidx` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `webauthn_creds_user_idx` ON `webauthn_credentials` (`user_id`);--> statement-breakpoint
CREATE INDEX `appeals_status_idx` ON `appeals` (`status`);--> statement-breakpoint
CREATE INDEX `appeals_record_idx` ON `appeals` (`recordId`);--> statement-breakpoint
CREATE UNIQUE INDEX `awards_campus_class_week_uidx` ON `awards` (`campusId`,`classId`,`week`);--> statement-breakpoint
CREATE INDEX `awards_campus_week_idx` ON `awards` (`campusId`,`week`);--> statement-breakpoint
CREATE UNIQUE INDEX `campuses_code_uidx` ON `campuses` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `classes_campus_grade_name_uidx` ON `classes` (`campusId`,`gradeId`,`name`);--> statement-breakpoint
CREATE INDEX `classes_campus_idx` ON `classes` (`campusId`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_summaries_campus_date_uidx` ON `dailySummaries` (`campusId`,`date`);--> statement-breakpoint
CREATE INDEX `daily_summaries_campus_week_idx` ON `dailySummaries` (`campusId`,`week`);--> statement-breakpoint
CREATE INDEX `duty_groups_campus_idx` ON `dutyGroups` (`campusId`);--> statement-breakpoint
CREATE UNIQUE INDEX `grades_campus_name_uidx` ON `grades` (`campusId`,`name`);--> statement-breakpoint
CREATE INDEX `grades_campus_idx` ON `grades` (`campusId`);--> statement-breakpoint
CREATE INDEX `record_logs_record_idx` ON `recordLogs` (`recordId`);--> statement-breakpoint
CREATE INDEX `records_campus_week_idx` ON `records` (`campusId`,`week`);--> statement-breakpoint
CREATE INDEX `records_class_idx` ON `records` (`classId`);--> statement-breakpoint
CREATE INDEX `records_status_idx` ON `records` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `settings_campus_key_uidx` ON `settings` (`campusId`,`key`);--> statement-breakpoint
CREATE INDEX `settings_campus_idx` ON `settings` (`campusId`);--> statement-breakpoint
CREATE INDEX `tags_campus_idx` ON `tags` (`campusId`);--> statement-breakpoint
CREATE INDEX `templates_campus_idx` ON `templates` (`campusId`);--> statement-breakpoint
CREATE INDEX `user_profiles_campus_idx` ON `userProfiles` (`campusId`);
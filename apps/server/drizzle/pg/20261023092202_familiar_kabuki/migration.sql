CREATE TABLE "appealTokens" (
	"tokenHash" text PRIMARY KEY,
	"recordId" uuid NOT NULL,
	"teacherDingtalkId" text NOT NULL,
	"expiresAt" bigint NOT NULL,
	"consumedAt" bigint,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dingtalkContacts" (
	"userId" text PRIMARY KEY,
	"unionId" text,
	"name" text NOT NULL,
	"mobile" text,
	"title" text,
	"avatarUrl" text,
	"deptIds" jsonb,
	"deptNames" jsonb,
	"syncedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificationLogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campusId" uuid NOT NULL,
	"recipientUserId" uuid,
	"recipientPlatformId" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recordId" uuid,
	"week" text,
	"title" text,
	"dedupeKey" text,
	"providerTaskId" text,
	"error" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sentAt" bigint,
	CONSTRAINT "notification_logs_kind_check" CHECK (kind IN ('record_deduction', 'record_positive', 'weekly_report')),
	CONSTRAINT "notification_logs_status_check" CHECK (status IN ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "appeals" ADD COLUMN "campusId" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "appeals" ADD COLUMN "teacherDingtalkId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "teacherDingtalkId" text;--> statement-breakpoint
ALTER TABLE "recordLogs" ADD COLUMN "operatorDingtalkId" text;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "tagIds" jsonb;--> statement-breakpoint
ALTER TABLE "records" DROP COLUMN "tagId";--> statement-breakpoint
ALTER TABLE "appeals" ALTER COLUMN "teacherId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recordLogs" ALTER COLUMN "operatorId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "score" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "score" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "appeal_tokens_record_idx" ON "appealTokens" ("recordId");--> statement-breakpoint
CREATE INDEX "appeal_tokens_expires_idx" ON "appealTokens" ("expiresAt");--> statement-breakpoint
CREATE INDEX "appeals_campus_idx" ON "appeals" ("campusId");--> statement-breakpoint
CREATE INDEX "classes_teacher_idx" ON "classes" ("teacherDingtalkId");--> statement-breakpoint
CREATE INDEX "dingtalk_contacts_name_idx" ON "dingtalkContacts" ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_logs_dedupe_uidx" ON "notificationLogs" ("dedupeKey");--> statement-breakpoint
CREATE INDEX "notification_logs_campus_idx" ON "notificationLogs" ("campusId");--> statement-breakpoint
CREATE INDEX "notification_logs_status_idx" ON "notificationLogs" ("status");--> statement-breakpoint
CREATE INDEX "notification_logs_record_idx" ON "notificationLogs" ("recordId");--> statement-breakpoint
ALTER TABLE "recordLogs" DROP CONSTRAINT "record_logs_action_check", ADD CONSTRAINT "record_logs_action_check" CHECK (action IN ('create', 'revoke', 'appeal', 'adjust', 'appeal_reject'));--> statement-breakpoint
ALTER TABLE "records" DROP CONSTRAINT "records_status_check", ADD CONSTRAINT "records_status_check" CHECK (status IN ('active', 'revoked', 'appealing'));
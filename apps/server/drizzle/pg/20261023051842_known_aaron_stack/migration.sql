ALTER TABLE "appeals" ADD COLUMN "campusId" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "teacherUserId" uuid;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "tagIds" jsonb;--> statement-breakpoint
ALTER TABLE "records" DROP COLUMN "tagId";--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "score" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "score" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "appeals_campus_idx" ON "appeals" ("campusId");--> statement-breakpoint
CREATE INDEX "classes_teacher_idx" ON "classes" ("teacherUserId");--> statement-breakpoint
ALTER TABLE "recordLogs" DROP CONSTRAINT "record_logs_action_check", ADD CONSTRAINT "record_logs_action_check" CHECK (action IN ('create', 'revoke', 'appeal', 'adjust', 'appeal_reject'));--> statement-breakpoint
ALTER TABLE "records" DROP CONSTRAINT "records_status_check", ADD CONSTRAINT "records_status_check" CHECK (status IN ('active', 'revoked', 'appealing'));
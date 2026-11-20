-- Persist encrypted GitHub OAuth session per user across browsers and devices
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "githubSessionEncrypted" TEXT;

-- Add CANCELLED status to TaskStatus enum
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
